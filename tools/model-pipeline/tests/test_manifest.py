from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from pathlib import Path

import onnx
import pytest

from ppdoclayout.build_manifest import build_manifest, canonical_json


ROOT = Path(__file__).parents[3]
PIPELINE_DIR = ROOT / "tools" / "model-pipeline"
MODEL_VERSION = "1.0.2"
ARTIFACT_VERSION = "1.0.1"
RELEASE_TAG = "v1.0.1-models"
ARTIFACT_DIR = ROOT / "models" / "pp-doclayoutv3" / ARTIFACT_VERSION
HISTORICAL_DIR = ROOT / "models" / "pp-doclayoutv3" / "1.0.0"
MANIFEST_PATH = ROOT / "models" / "pp-doclayoutv3" / MODEL_VERSION / "manifest.json"
CONTRACT_PATH = PIPELINE_DIR / "artifacts" / "model-contract.json"
FP32_REPORT_PATH = PIPELINE_DIR / "reports" / MODEL_VERSION / "fp32-validation.json"
VARIANT_REPORT_PATH = PIPELINE_DIR / "reports" / MODEL_VERSION / "variant-validation.json"
BROWSER_REPORT_PATH = PIPELINE_DIR / "reports" / MODEL_VERSION / "browser-evidence.json"
EXPECTED_OUTPUTS = ["logits", "pred_boxes", "order_logits", "out_masks"]
EXPECTED_VARIANTS = {
    "fp16": {
        "bytes": 74279796,
        "sha256": "463ba56faa555baf84271b4002b33b0c5fcc50776fe4f39344235eccb72073f2",
    },
    "fp32": {
        "bytes": 142574928,
        "sha256": "476da6d3892bc6211ec90f53df1f68722626b3cf67af77d1c75bd0bd2ee8d269",
    },
}
SOURCE_SHA256 = "5ea422c6cc5fe759a47e1357c35639b58173508e025a3131cbe4b6ac59e2b85e"
HISTORICAL_FP32_SHA256 = (
    "fc2eebdc2153ad4e6993766f914f78f47a737fed123a78731bc9c57f7a6c806b"
)
RELEASE_BASE = (
    "https://github.com/chenmohan123/web-sdk-PP-DocLayoutV3/"
    f"releases/download/{RELEASE_TAG}/"
)
HISTORICAL_RELEASE_BASE = (
    "https://github.com/chenmohan123/web-sdk-PP-DocLayoutV3/"
    "releases/download/v1.0.0-models/"
)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_manifest() -> dict:
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))


def build_from_paths(
    *,
    contract_path: Path = CONTRACT_PATH,
    fp32_report_path: Path = FP32_REPORT_PATH,
    variant_report_path: Path = VARIANT_REPORT_PATH,
    browser_report_path: Path = BROWSER_REPORT_PATH,
) -> dict:
    return build_manifest(
        contract_path=contract_path,
        fp32_report_path=fp32_report_path,
        variant_report_path=variant_report_path,
        browser_report_path=browser_report_path,
        model_dir=ARTIFACT_DIR,
        model_version=MODEL_VERSION,
        release_tag=RELEASE_TAG,
    )


def test_manifest_has_stable_browser_runtime_contract() -> None:
    manifest = load_manifest()

    assert manifest["schemaVersion"] == 1
    assert manifest["model"]["id"] == "pp-doclayoutv3"
    assert manifest["model"]["version"] == MODEL_VERSION
    assert manifest["minSdkVersion"] == "1.0.0"
    assert len(manifest["labels"]) == 25
    assert manifest["input"] == {
        "dtype": "float32",
        "name": "pixel_values",
        "shape": [1, 3, 800, 800],
    }
    assert [output["name"] for output in manifest["outputs"]] == EXPECTED_OUTPUTS
    assert manifest["preprocessing"]["size"] == {"height": 800, "width": 800}
    assert manifest["preprocessing"]["rescaleFactor"] == pytest.approx(1 / 255)


def test_manifest_variants_are_sorted_integrity_bound_and_validated() -> None:
    manifest = load_manifest()
    variants = manifest["variants"]

    assert [variant["id"] for variant in variants] == sorted(
        variant["id"] for variant in variants
    )
    assert manifest["variantPriority"] == ["fp16", "fp32"]
    assert [variant["id"] for variant in variants] == ["fp16", "fp32"]
    for variant in variants:
        expected = EXPECTED_VARIANTS[variant["id"]]
        model_path = ARTIFACT_DIR / variant["filename"]
        assert variant["bytes"] == expected["bytes"] == model_path.stat().st_size
        assert variant["sha256"] == expected["sha256"] == sha256_file(model_path)
        assert variant["opset"] == 18
        assert variant["url"] == RELEASE_BASE + variant["filename"]
        assert "latest" not in variant["url"]
        assert variant["validation"]["pass"] is True
        assert variant["validation"]["included"] is True

    by_id = {variant["id"]: variant for variant in variants}
    assert by_id["fp16"]["precision"] == "fp16"
    assert by_id["fp16"]["backendCompatibility"] == ["wasm", "webgpu"]
    assert by_id["fp32"]["precision"] == "fp32"
    assert by_id["fp32"]["backendCompatibility"] == ["wasm", "webgpu"]


def test_manifest_records_upstream_source_and_hashes() -> None:
    manifest = load_manifest()

    assert manifest["source"]["license"] == "Apache-2.0"
    assert manifest["source"]["url"] == (
        "https://huggingface.co/PaddlePaddle/PP-DocLayoutV3_safetensors"
    )
    assert manifest["source"]["files"]["model.safetensors"] == SOURCE_SHA256
    assert manifest["source"]["files"] == json.loads(
        CONTRACT_PATH.read_text(encoding="utf-8")
    )["source"]["files"]


def test_manifest_matches_generator_and_is_canonical_json() -> None:
    generated = canonical_json(build_from_paths())

    assert MANIFEST_PATH.read_bytes() == generated
    assert generated.endswith(b"\n")
    assert b"\r\n" not in generated


def test_published_1_0_0_manifest_remains_immutable() -> None:
    manifest = json.loads(
        (HISTORICAL_DIR / "manifest.json").read_text(encoding="utf-8")
    )
    by_id = {variant["id"]: variant for variant in manifest["variants"]}

    assert manifest["model"]["version"] == "1.0.0"
    assert by_id["fp16"]["backendCompatibility"] == ["webgpu"]
    assert by_id["fp32"]["backendCompatibility"] == ["wasm"]


def test_published_1_0_1_manifest_remains_immutable() -> None:
    manifest = json.loads(
        (ARTIFACT_DIR / "manifest.json").read_text(encoding="utf-8")
    )
    by_id = {variant["id"]: variant for variant in manifest["variants"]}

    assert manifest["model"]["version"] == "1.0.1"
    assert by_id["fp16"]["backendCompatibility"] == ["webgpu"]
    assert by_id["fp32"]["backendCompatibility"] == ["wasm", "webgpu"]
    assert by_id["fp16"]["sha256"] == EXPECTED_VARIANTS["fp16"]["sha256"]
    assert by_id["fp32"]["sha256"] == EXPECTED_VARIANTS["fp32"]["sha256"]


def test_generator_inspects_real_onnx_contract() -> None:
    manifest = build_from_paths()

    for variant in manifest["variants"]:
        model = onnx.load(ARTIFACT_DIR / variant["filename"], load_external_data=False)
        assert [value.name for value in model.graph.input] == [
            manifest["input"]["name"]
        ]
        assert [value.name for value in model.graph.output] == EXPECTED_OUTPUTS
        assert (
            next(
                item.version
                for item in model.opset_import
                if item.domain in ("", "ai.onnx")
            )
            == 18
        )


def test_rejected_int8_is_not_publishable() -> None:
    report = json.loads(VARIANT_REPORT_PATH.read_text(encoding="utf-8"))
    assert report["variants"]["int8"]["pass"] is False
    assert report["variants"]["int8"]["included"] is False

    manifest = build_from_paths()

    assert "int8" not in {variant["id"] for variant in manifest["variants"]}


def test_fp32_requires_strict_wasm_and_webgpu_evidence(tmp_path: Path) -> None:
    evidence = json.loads(BROWSER_REPORT_PATH.read_text(encoding="utf-8"))
    evidence["fp32Webgpu"]["fallbacks"] = [{"provider": "wasm"}]
    path = tmp_path / "browser-evidence.json"
    path.write_text(json.dumps(evidence), encoding="utf-8")

    with pytest.raises(ValueError, match="fallback"):
        build_from_paths(browser_report_path=path)


def test_manifest_advertises_validated_fp32_for_both_backends() -> None:
    manifest = build_from_paths()
    fp32 = next(item for item in manifest["variants"] if item["id"] == "fp32")

    assert manifest["model"]["version"] == MODEL_VERSION
    assert manifest["variantPriority"] == ["fp16", "fp32"]
    assert fp32["backendCompatibility"] == ["wasm", "webgpu"]
    assert fp32["url"].endswith(f"/{RELEASE_TAG}/model-fp32.onnx")


def test_model_readme_documents_distribution_and_reproducibility() -> None:
    readme = (ROOT / "models" / "README.md").read_text(encoding="utf-8")

    assert readme.startswith("# 模型文件")
    assert "Model files" in readme
    assert "142574928" in readme
    assert HISTORICAL_FP32_SHA256 in readme
    assert "74279796" in readme
    assert EXPECTED_VARIANTS["fp16"]["sha256"] in readme
    assert "INT8" in readme and "不发布" in readme
    assert "python.exe -m ppdoclayout.build_manifest" in readme
    assert HISTORICAL_RELEASE_BASE in readme
    assert "latest" in readme
    assert "自定义微调模型" in readme
    assert "Apache-2.0" in readme
    assert "https://modelscope.cn/models/PaddlePaddle/PP-DocLayoutV3" in readme


def test_third_party_notices_records_exact_upstream_attribution() -> None:
    notices = (ROOT / "THIRD_PARTY_NOTICES.md").read_text(encoding="utf-8")
    citation = (
        "RT-DocLayout: Real-Time End-to-End Document Layout Analysis with Reading "
        "Order in the Wild; Cheng Cui, Tingquan Gao, Xueqing Wang, Changda Zhou, "
        "Hongen Liu, Ting Sun, Yubo Zhang, Zelun Zhang, Jiaxuan Liu, Manhui Lin, "
        "Yue Zhang, Suyin Liang, Yiqing Xiang, Yi Liu; 2026; arXiv:2606.23344; "
        "https://arxiv.org/abs/2606.23344"
    )

    assert notices.startswith("# 第三方声明")
    assert "Third-Party Notices" in notices
    assert "PaddlePaddle PP-DocLayoutV3" in notices
    assert "Apache-2.0" in notices
    assert "https://huggingface.co/PaddlePaddle/PP-DocLayoutV3_safetensors" in notices
    assert "https://github.com/PaddlePaddle/PaddleOCR" in notices
    assert citation in notices
    assert "ONNX" in notices
    assert "认可或背书" in notices


@pytest.mark.parametrize(
    ("report_name", "mutation", "expected_message"),
    [
        (
            "fp32",
            lambda report: report["sourceHashes"].update({"onnx": "0" * 64}),
            "FP32 report SHA-256",
        ),
        (
            "fp32",
            lambda report: report.update({"overallPass": False}),
            "FP32 validation did not pass",
        ),
        (
            "variant",
            lambda report: report["variants"]["fp16"].update({"bytes": 1}),
            "FP16 report byte size",
        ),
        (
            "variant",
            lambda report: report["variants"]["int8"].update(
                {"pass": False, "included": True}
            ),
            "INT8 validation status is inconsistent",
        ),
    ],
)
def test_generator_fails_closed_on_inconsistent_reports(
    tmp_path: Path,
    report_name: str,
    mutation,
    expected_message: str,
) -> None:
    fp32_report = json.loads(FP32_REPORT_PATH.read_text(encoding="utf-8"))
    variant_report = json.loads(VARIANT_REPORT_PATH.read_text(encoding="utf-8"))
    selected = fp32_report if report_name == "fp32" else variant_report
    mutation(selected)
    fp32_path = tmp_path / "fp32-validation.json"
    variant_path = tmp_path / "variant-validation.json"
    fp32_path.write_text(json.dumps(fp32_report), encoding="utf-8")
    variant_path.write_text(json.dumps(variant_report), encoding="utf-8")

    with pytest.raises(ValueError, match=expected_message):
        build_from_paths(
            fp32_report_path=fp32_path,
            variant_report_path=variant_path,
        )
