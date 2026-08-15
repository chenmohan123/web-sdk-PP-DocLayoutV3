import json
import sys
import warnings
from copy import deepcopy
from argparse import Namespace
from pathlib import Path

import onnx
import numpy as np
import pytest

from ppdoclayout.convert_fp16 import convert_fp16, fp32_cast_nodes
from ppdoclayout.validate import sha256_file
from ppdoclayout import variant_validation


ROOT = Path(__file__).parents[3]
OLD_MODEL_DIR = ROOT / "models" / "pp-doclayoutv3" / "1.0.0"
MODEL_DIR = ROOT / "models" / "pp-doclayoutv3" / "1.0.1"
REPORT_PATH = (
    ROOT / "tools" / "model-pipeline" / "reports" / "1.0.2" / "variant-validation.json"
)
ACCEPTED_REPORT_PATH = (
    ROOT / "tools" / "model-pipeline" / "reports" / "variant-validation.json"
)


def test_fp32_semantic_casts_are_preserved() -> None:
    model = onnx.load(MODEL_DIR / "model-fp32.onnx", load_external_data=False)

    assert fp32_cast_nodes(model) == {
        "node__to_copy_4",
        "node__to_copy_11",
        "node__to_copy_12",
        "node__to_copy_13",
        "node_convert_element_type_default",
        "node_convert_element_type_default_2",
    }


def test_converter_cli_uses_default_block_list(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        sys,
        "argv",
        ["convert_fp16", "--source", "source.onnx", "--output", "output.onnx"],
    )

    from ppdoclayout.convert_fp16 import parse_args

    assert parse_args().block_op is None


def test_fp16_graph_is_self_contained_and_smaller() -> None:
    fp32_path = MODEL_DIR / "model-fp32.onnx"
    fp16_path = MODEL_DIR / "model-fp16.onnx"

    assert fp16_path.exists(), "FP16 model has not been converted"
    model = onnx.load(fp16_path, load_external_data=False)
    onnx.checker.check_model(model)
    assert all(not initializer.external_data for initializer in model.graph.initializer)
    assert all(
        initializer.data_type != onnx.TensorProto.DOUBLE
        for initializer in model.graph.initializer
    ), "WebGPU does not support double initializers"
    assert all(
        value.type.tensor_type.elem_type != onnx.TensorProto.DOUBLE
        for value in model.graph.value_info
    ), "WebGPU graph metadata must not declare double tensors"
    assert any(
        initializer.data_type == onnx.TensorProto.FLOAT16
        for initializer in model.graph.initializer
    )
    assert fp16_path.stat().st_size < fp32_path.stat().st_size

    fp16_casts = {
        node.name
        for node in model.graph.node
        if node.op_type == "Cast"
        and any(
            attribute.name == "to" and attribute.i == onnx.TensorProto.FLOAT
            for attribute in node.attribute
        )
    }
    assert fp32_cast_nodes(onnx.load(fp32_path, load_external_data=False)) <= fp16_casts


def test_fp16_conversion_is_byte_reproducible(tmp_path: Path) -> None:
    regenerated = tmp_path / "model-fp16.onnx"
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", module="onnxconverter_common.float16")
        convert_fp16(OLD_MODEL_DIR / "model-fp32.onnx", regenerated)

    assert sha256_file(regenerated) == sha256_file(MODEL_DIR / "model-fp16.onnx")


def test_model_1_0_1_reuses_accepted_fp16_bytes() -> None:
    assert (MODEL_DIR / "model-fp16.onnx").read_bytes() == (
        OLD_MODEL_DIR / "model-fp16.onnx"
    ).read_bytes()


def test_rejected_int8_evidence_is_carried_forward_without_binary() -> None:
    accepted = json.loads(ACCEPTED_REPORT_PATH.read_text(encoding="utf-8"))["variants"][
        "int8"
    ]
    candidate = json.loads(REPORT_PATH.read_text(encoding="utf-8"))["variants"]["int8"]

    assert accepted["pass"] is False
    assert accepted["included"] is False
    assert candidate == accepted
    assert not (MODEL_DIR / "model-int8.onnx").exists()


def test_validation_cli_uses_accepted_int8_report(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "variant_validation",
            "--model",
            str(tmp_path / "model"),
            "--fp32",
            str(tmp_path / "fp32.onnx"),
            "--fp16",
            str(tmp_path / "fp16.onnx"),
            "--accepted-variant-report",
            str(tmp_path / "accepted.json"),
            "--fixtures-lock",
            str(tmp_path / "fixtures.json"),
            "--output",
            str(tmp_path / "report.json"),
        ],
    )

    args = variant_validation.parse_args()

    assert args.accepted_variant_report == tmp_path / "accepted.json"
    assert not hasattr(args, "int8")


def test_report_and_browser_evidence_are_bound_to_fp16_artifact() -> None:
    report = json.loads(REPORT_PATH.read_text(encoding="utf-8"))
    browser_evidence = json.loads(
        (REPORT_PATH.parent / "browser-evidence.json").read_text(encoding="utf-8")
    )
    webgpu_evidence = browser_evidence["fp16Webgpu"]
    wasm_evidence = browser_evidence["fp16Wasm"]
    fp16_path = MODEL_DIR / "model-fp16.onnx"

    assert report["variants"]["fp16"]["bytes"] == fp16_path.stat().st_size
    assert report["variants"]["fp16"]["sha256"] == sha256_file(fp16_path)
    assert report["source"]["fp32Sha256"] == sha256_file(MODEL_DIR / "model-fp32.onnx")
    for backend, evidence in (
        ("webgpu", webgpu_evidence),
        ("wasm", wasm_evidence),
    ):
        assert evidence["status"] == "passed"
        assert evidence["executionProvider"] == backend
        assert evidence["modelBytes"] == fp16_path.stat().st_size
        assert evidence["modelSha256"] == sha256_file(fp16_path)
        assert evidence["onnxruntimeWebVersion"] == "1.27.0"
        assert all(output["allFinite"] for output in evidence["outputs"].values())
        assert all(len(output["sha256"]) == 64 for output in evidence["outputs"].values())
    assert "shader-f16" in webgpu_evidence["adapterFeatures"]

    resize_evidence = report["variants"]["fp16"]["blockedOpEvidence"][0]
    assert resize_evidence["opType"] == "Resize"
    assert resize_evidence["withoutBlock"]["status"] == "failed"
    assert resize_evidence["withoutBlock"]["stage"] == "onnx.shape_inference"
    assert len(resize_evidence["withoutBlock"]["nodes"]) == 6

    sdk_package = json.loads((ROOT / "packages" / "sdk" / "package.json").read_text())
    assert sdk_package["dependencies"]["onnxruntime-web"] == webgpu_evidence[
        "onnxruntimeWebVersion"
    ]


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("modelSha256", "0" * 64),
        ("onnxruntimeWebVersion", "0.0.0"),
    ],
)
def test_stale_browser_evidence_is_rejected(field: str, value: str) -> None:
    evidence = json.loads(
        (REPORT_PATH.parent / "browser-evidence.json").read_text(encoding="utf-8")
    )["fp16Webgpu"]
    stale = deepcopy(evidence)
    stale[field] = value

    assert variant_validation._browser_evidence_errors(
        stale, MODEL_DIR / "model-fp16.onnx", "fp16", "webgpu"
    )


def test_non_finite_browser_output_is_rejected() -> None:
    evidence = json.loads(
        (REPORT_PATH.parent / "browser-evidence.json").read_text(encoding="utf-8")
    )["fp16Webgpu"]
    invalid = deepcopy(evidence)
    invalid["outputs"]["logits"]["allFinite"] = False

    errors = variant_validation._browser_evidence_errors(
        invalid, MODEL_DIR / "model-fp16.onnx", "fp16", "webgpu"
    )
    assert any("non-finite" in error for error in errors)


def test_wasm_browser_evidence_must_report_wasm_provider() -> None:
    evidence = json.loads(
        (REPORT_PATH.parent / "browser-evidence.json").read_text(encoding="utf-8")
    )["fp16Webgpu"]
    invalid = deepcopy(evidence)
    invalid["executionProvider"] = "webgpu"

    errors = variant_validation._browser_evidence_errors(
        invalid, MODEL_DIR / "model-fp16.onnx", "fp16", "wasm"
    )

    assert any("not wasm" in error for error in errors)


def test_false_positive_detections_fail_variant_acceptance() -> None:
    candidate = {
        "matchedDetectionRatio": 1.0,
        "matchedDetectionPrecision": 0.5,
        "maxScoreDelta": 0.0,
        "meanPolygonPointDistancePixels": 0.0,
        "sizeRatio": 0.5,
    }

    assert variant_validation._passes(candidate, "fp16") is False


def test_polygon_distance_preserves_point_correspondence() -> None:
    reference = np.asarray([[0, 0], [10, 0], [10, 10], [0, 10]])
    reordered = np.asarray([[10, 10], [0, 10], [0, 0], [10, 0]])

    assert variant_validation.polygon_distance(reference, reordered) > 0


def test_int8_accepts_speed_alternative_when_size_is_over_limit() -> None:
    candidate = {
        "matchedDetectionRatio": 1.0,
        "matchedDetectionPrecision": 1.0,
        "maxScoreDelta": 0.0,
        "meanPolygonPointDistancePixels": 0.0,
        "sizeRatio": 0.7,
        "medianWasmSpeedup": 0.2,
    }

    assert variant_validation._passes(candidate, "int8") is True


def test_validation_cli_fails_without_passing_browser_evidence(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    paths = [tmp_path / name for name in ("model", "fp32", "fp16", "accepted", "lock")]
    for path in paths:
        path.write_bytes(b"placeholder")
    monkeypatch.setattr(
        variant_validation,
        "parse_args",
        lambda: Namespace(
            model=paths[0],
            fp32=paths[1],
            fp16=paths[2],
            accepted_variant_report=paths[3],
            fixtures_lock=paths[4],
            browser_evidence=None,
            output=tmp_path / "report.json",
        ),
    )
    monkeypatch.setattr(
        variant_validation,
        "build_variant_report",
        lambda *args: {"variants": {"fp16": {"pass": False}}},
    )
    monkeypatch.setattr(variant_validation, "write_report", lambda *args: None)

    with pytest.raises(SystemExit):
        variant_validation.main()


def test_only_accepted_variants_are_publishable() -> None:
    report = json.loads(REPORT_PATH.read_text(encoding="utf-8"))
    fp16 = report["variants"]["fp16"]

    assert fp16["pass"] is True
    assert fp16["included"] is fp16["pass"]
    assert fp16["matchedDetectionRatio"] >= 0.99
    assert fp16["maxScoreDelta"] <= 0.02
    assert fp16["meanPolygonPointDistancePixels"] <= 2.0
    assert fp16["browser"]["webgpu"]["status"] == "passed"
    assert fp16["browser"]["wasm"]["status"] == "passed"

    int8_path = MODEL_DIR / "model-int8.onnx"
    int8 = report["variants"]["int8"]
    if int8_path.exists():
        assert int8["pass"] is True
        assert int8["matchedDetectionRatio"] >= 0.97
        assert int8["maxScoreDelta"] <= 0.05
        assert int8["meanPolygonPointDistancePixels"] <= 4.0
        assert int8["sizeRatio"] <= 0.60 or int8["medianWasmSpeedup"] >= 0.10
        assert int8["browser"]["wasm"]["status"] == "passed"
    else:
        assert int8["included"] is False
        assert int8["pass"] is False
        assert int8["exclusionReasons"]
