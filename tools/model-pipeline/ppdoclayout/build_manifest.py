from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any

import onnx


MODEL_ID = "pp-doclayoutv3"
MIN_SDK_VERSION = "1.0.0"
SEMVER = re.compile(r"^\d+\.\d+\.\d+$")
RELEASE_TAG = re.compile(r"^v\d+\.\d+\.\d+-models$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
EXPECTED_INPUT_NAME = "pixel_values"
EXPECTED_INPUT_SHAPE = [1, 3, 800, 800]
EXPECTED_OUTPUT_NAMES = ["logits", "pred_boxes", "order_logits", "out_masks"]
EXPECTED_OPSET = 18
SOURCE_URL = "https://huggingface.co/PaddlePaddle/PP-DocLayoutV3_safetensors"
ROOT = Path(__file__).parents[3]


def release_base_url(model_version: str, release_tag: str) -> str:
    if not SEMVER.fullmatch(model_version):
        raise ValueError(f"Invalid model version: {model_version}")
    if not RELEASE_TAG.fullmatch(release_tag):
        raise ValueError(f"Invalid model release tag: {release_tag}")
    return (
        "https://github.com/chenmohan123/web-sdk-PP-DocLayoutV3/"
        f"releases/download/{release_tag}/"
    )


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_json(value: dict[str, Any]) -> bytes:
    return (
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    ).encode("utf-8")


def _load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"Expected a JSON object: {path}")
    return value


def _tensor_shape(value_info: onnx.ValueInfoProto) -> list[int]:
    return [dimension.dim_value for dimension in value_info.type.tensor_type.shape.dim]


def _tensor_dtype(value_info: onnx.ValueInfoProto) -> str:
    element_type = value_info.type.tensor_type.elem_type
    if element_type != onnx.TensorProto.FLOAT:
        raise ValueError(
            f"ONNX tensor {value_info.name} must use float32 at the graph boundary"
        )
    return "float32"


def _inspect_onnx(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise ValueError(f"ONNX artifact does not exist: {path}")
    model = onnx.load(path, load_external_data=False)
    onnx.checker.check_model(model)
    if any(initializer.external_data for initializer in model.graph.initializer):
        raise ValueError(f"ONNX artifact must be self-contained: {path}")

    input_names = [value.name for value in model.graph.input]
    output_names = [value.name for value in model.graph.output]
    if input_names != [EXPECTED_INPUT_NAME]:
        raise ValueError(f"Unexpected ONNX inputs for {path.name}: {input_names}")
    if output_names != EXPECTED_OUTPUT_NAMES:
        raise ValueError(f"Unexpected ONNX outputs for {path.name}: {output_names}")
    if _tensor_shape(model.graph.input[0]) != EXPECTED_INPUT_SHAPE:
        raise ValueError(f"Unexpected ONNX input shape for {path.name}")

    standard_opsets = [
        item.version for item in model.opset_import if item.domain in ("", "ai.onnx")
    ]
    if standard_opsets != [EXPECTED_OPSET]:
        raise ValueError(f"Unexpected ONNX opset for {path.name}: {standard_opsets}")

    return {
        "bytes": path.stat().st_size,
        "input": {
            "dtype": _tensor_dtype(model.graph.input[0]),
            "name": model.graph.input[0].name,
            "shape": _tensor_shape(model.graph.input[0]),
        },
        "opset": standard_opsets[0],
        "outputs": [
            {
                "dtype": _tensor_dtype(value),
                "name": value.name,
                "shape": _tensor_shape(value),
            }
            for value in model.graph.output
        ],
        "sha256": sha256_file(path),
    }


def _validate_contract(
    contract: dict[str, Any], fp32: dict[str, Any], fp16: dict[str, Any]
) -> list[dict[str, Any]]:
    if contract.get("input") != fp32["input"]:
        raise ValueError("Model contract input does not match FP32 ONNX")
    if fp16["input"] != fp32["input"]:
        raise ValueError("FP16 ONNX input does not match FP32 ONNX")
    labels = contract.get("labels")
    if not isinstance(labels, list) or len(labels) != 25:
        raise ValueError("Model contract must contain exactly 25 labels")

    contract_outputs = contract.get("outputs")
    if not isinstance(contract_outputs, dict):
        raise ValueError("Model contract outputs must be an object")
    outputs = []
    for actual in fp32["outputs"]:
        expected = contract_outputs.get(actual["name"])
        if expected != {"dtype": actual["dtype"], "shape": actual["shape"]}:
            raise ValueError(
                f"Model contract output does not match FP32 ONNX: {actual['name']}"
            )
        outputs.append(actual)
    if fp16["outputs"] != outputs:
        raise ValueError("FP16 ONNX outputs do not match FP32 ONNX")
    return outputs


def _validation_status(report: dict[str, Any], name: str) -> tuple[bool, bool]:
    passed = report.get("pass")
    included = report.get("included")
    if not isinstance(passed, bool) or not isinstance(included, bool):
        raise ValueError(f"{name} validation status is missing")
    if passed != included:
        raise ValueError(f"{name} validation status is inconsistent")
    return passed, included


def _validate_fp32_browser_evidence(
    report: dict[str, Any], fp32: dict[str, Any]
) -> None:
    if report.get("schemaVersion") != 1:
        raise ValueError("Unsupported browser evidence schema")

    for key, backend in (("fp32Wasm", "wasm"), ("fp32Webgpu", "webgpu")):
        evidence = report.get(key)
        if not isinstance(evidence, dict):
            raise ValueError(f"FP32 {backend} browser evidence is missing")
        if evidence.get("status") != "passed":
            raise ValueError(f"FP32 {backend} browser validation did not pass")
        if evidence.get("executionProvider") != backend:
            raise ValueError(f"FP32 {backend} execution provider does not match")
        if evidence.get("precision") != "fp32":
            raise ValueError(f"FP32 {backend} precision does not match")
        if evidence.get("fallbacks") != []:
            raise ValueError(f"FP32 {backend} browser evidence contains fallback records")
        if evidence.get("modelBytes") != fp32["bytes"]:
            raise ValueError(f"FP32 {backend} browser byte size does not match")
        if evidence.get("modelSha256") != fp32["sha256"]:
            raise ValueError(f"FP32 {backend} browser SHA-256 does not match")
        if evidence.get("onnxruntimeWebVersion") != "1.27.0":
            raise ValueError(f"FP32 {backend} ONNX Runtime Web version does not match")

        fixtures = evidence.get("fixtures")
        if not isinstance(fixtures, list) or len(fixtures) != 7:
            raise ValueError(f"FP32 {backend} evidence must contain seven fixtures")
        filenames = set()
        for fixture in fixtures:
            if not isinstance(fixture, dict) or fixture.get("parity") != "passed":
                raise ValueError(f"FP32 {backend} fixture parity did not pass")
            filename = fixture.get("filename")
            if not isinstance(filename, str) or not filename or filename in filenames:
                raise ValueError(f"FP32 {backend} fixture identity is invalid")
            filenames.add(filename)
            digest = fixture.get("outputSha256")
            if not isinstance(digest, str) or not SHA256.fullmatch(digest):
                raise ValueError(f"FP32 {backend} fixture output hash is invalid")

        if backend == "webgpu":
            adapter = evidence.get("adapter")
            if not isinstance(adapter, dict) or not any(
                isinstance(adapter.get(name), str) and adapter[name]
                for name in ("architecture", "description", "device", "vendor")
            ):
                raise ValueError("FP32 WebGPU adapter identity is missing")
            features = evidence.get("adapterFeatures")
            if (
                not isinstance(features, list)
                or not features
                or any(not isinstance(feature, str) or not feature for feature in features)
                or features != sorted(set(features))
            ):
                raise ValueError("FP32 WebGPU adapter feature list is invalid")


def build_manifest(
    *,
    contract_path: Path,
    fp32_report_path: Path,
    variant_report_path: Path,
    browser_report_path: Path,
    model_dir: Path,
    model_version: str,
    release_tag: str,
) -> dict[str, Any]:
    release_url = release_base_url(model_version, release_tag)
    contract = _load_json(contract_path)
    fp32_report = _load_json(fp32_report_path)
    variant_report = _load_json(variant_report_path)
    browser_report = _load_json(browser_report_path)
    fp32_path = model_dir / "model-fp32.onnx"
    fp16_path = model_dir / "model-fp16.onnx"
    fp32 = _inspect_onnx(fp32_path)
    fp16 = _inspect_onnx(fp16_path)
    outputs = _validate_contract(contract, fp32, fp16)

    if fp32_report.get("schemaVersion") != 1:
        raise ValueError("Unsupported FP32 validation report schema")
    if fp32_report.get("overallPass") is not True:
        raise ValueError("FP32 validation did not pass")
    fp32_source_hashes = fp32_report.get("sourceHashes", {})
    if fp32_source_hashes.get("onnx") != fp32["sha256"]:
        raise ValueError("FP32 report SHA-256 does not match the ONNX artifact")
    _validate_fp32_browser_evidence(browser_report, fp32)

    source_files = contract.get("source", {}).get("files")
    if not isinstance(source_files, dict) or "model.safetensors" not in source_files:
        raise ValueError("Model contract source hashes are missing")
    if fp32_source_hashes.get("modelSafetensors") != source_files["model.safetensors"]:
        raise ValueError("FP32 report source hash does not match the model contract")

    if variant_report.get("schemaVersion") != 1:
        raise ValueError("Unsupported variant validation report schema")
    if variant_report.get("source", {}).get("fp32Sha256") != fp32["sha256"]:
        raise ValueError("Variant report FP32 SHA-256 does not match the ONNX artifact")
    report_variants = variant_report.get("variants")
    if not isinstance(report_variants, dict):
        raise ValueError("Variant validation report variants are missing")

    int8_report = report_variants.get("int8")
    if not isinstance(int8_report, dict):
        raise ValueError("INT8 validation report is missing")
    _validation_status(int8_report, "INT8")

    variants = [
        {
            "backendCompatibility": ["wasm", "webgpu"],
            "bytes": fp32["bytes"],
            "filename": fp32_path.name,
            "id": "fp32",
            "opset": fp32["opset"],
            "precision": "fp32",
            "sha256": fp32["sha256"],
            "url": release_url + fp32_path.name,
            "validation": {
                "included": True,
                "pass": True,
                "report": f"tools/model-pipeline/reports/{model_version}/fp32-validation.json",
            },
        }
    ]

    fp16_report = report_variants.get("fp16")
    if not isinstance(fp16_report, dict):
        raise ValueError("FP16 validation report is missing")
    fp16_pass, fp16_included = _validation_status(fp16_report, "FP16")
    if fp16_pass and fp16_included:
        if fp16_report.get("filename") != fp16_path.name:
            raise ValueError("FP16 report filename does not match the ONNX artifact")
        if fp16_report.get("bytes") != fp16["bytes"]:
            raise ValueError("FP16 report byte size does not match the ONNX artifact")
        if fp16_report.get("sha256") != fp16["sha256"]:
            raise ValueError("FP16 report SHA-256 does not match the ONNX artifact")
        for backend in ("wasm", "webgpu"):
            browser = fp16_report.get("browser", {}).get(backend, {})
            if browser.get("status") != "passed":
                raise ValueError(f"FP16 browser {backend} validation did not pass")
            if browser.get("executionProvider") != backend:
                raise ValueError(f"FP16 browser provider does not match {backend}")
            if browser.get("modelBytes") != fp16["bytes"]:
                raise ValueError(
                    f"FP16 browser {backend} byte size does not match the ONNX artifact"
                )
            if browser.get("modelSha256") != fp16["sha256"]:
                raise ValueError(
                    f"FP16 browser {backend} SHA-256 does not match the ONNX artifact"
                )
        variants.append(
            {
                "backendCompatibility": ["wasm", "webgpu"],
                "bytes": fp16["bytes"],
                "filename": fp16_path.name,
                "id": "fp16",
                "opset": fp16["opset"],
                "precision": "fp16",
                "sha256": fp16["sha256"],
                "url": release_url + fp16_path.name,
                "validation": {
                    "included": fp16_included,
                    "pass": fp16_pass,
                    "report": f"tools/model-pipeline/reports/{model_version}/variant-validation.json",
                },
            }
        )

    processor = contract.get("preprocessor", {})
    size = processor.get("size", {})
    preprocessing = {
        "doNormalize": processor.get("do_normalize"),
        "doRescale": processor.get("do_rescale"),
        "doResize": processor.get("do_resize"),
        "imageMean": processor.get("image_mean"),
        "imageStd": processor.get("image_std"),
        "resample": processor.get("resample"),
        "rescaleFactor": processor.get("rescale_factor"),
        "size": {"height": size.get("height"), "width": size.get("width")},
    }
    if None in preprocessing.values() or None in preprocessing["size"].values():
        raise ValueError("Model preprocessing contract is incomplete")

    variants.sort(key=lambda variant: variant["id"])
    priority = [
        item
        for item in ("fp16", "fp32")
        if any(variant["id"] == item for variant in variants)
    ]
    return {
        "input": fp32["input"],
        "labels": contract["labels"],
        "minSdkVersion": MIN_SDK_VERSION,
        "model": {
            "architecture": contract.get("architecture"),
            "id": MODEL_ID,
            "modelType": contract.get("modelType"),
            "parameterCount": contract.get("parameterCount"),
            "version": model_version,
        },
        "outputs": outputs,
        "preprocessing": preprocessing,
        "schemaVersion": 1,
        "source": {
            "files": source_files,
            "license": "Apache-2.0",
            "name": "PaddlePaddle/PP-DocLayoutV3_safetensors",
            "url": SOURCE_URL,
        },
        "variantPriority": priority,
        "variants": variants,
    }


def write_manifest(
    *,
    contract_path: Path,
    fp32_report_path: Path,
    variant_report_path: Path,
    browser_report_path: Path,
    model_dir: Path,
    output_path: Path,
    model_version: str,
    release_tag: str,
) -> None:
    manifest = build_manifest(
        contract_path=contract_path,
        fp32_report_path=fp32_report_path,
        variant_report_path=variant_report_path,
        browser_report_path=browser_report_path,
        model_dir=model_dir,
        model_version=model_version,
        release_tag=release_tag,
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(canonical_json(manifest))


def parse_args() -> argparse.Namespace:
    pipeline_dir = ROOT / "tools" / "model-pipeline"
    parser = argparse.ArgumentParser(description="Build the versioned model manifest")
    parser.add_argument("--model-version", default="1.0.2")
    parser.add_argument("--artifact-version", default="1.0.1")
    parser.add_argument("--release-tag", default="v1.0.1-models")
    parser.add_argument(
        "--contract",
        type=Path,
        default=pipeline_dir / "artifacts" / "model-contract.json",
    )
    parser.add_argument(
        "--fp32-report",
        type=Path,
        default=None,
    )
    parser.add_argument(
        "--variant-report",
        type=Path,
        default=None,
    )
    parser.add_argument("--browser-report", type=Path, default=None)
    parser.add_argument("--model-dir", type=Path, default=None)
    parser.add_argument("--output", type=Path, default=None)
    args = parser.parse_args()
    if not SEMVER.fullmatch(args.artifact_version):
        parser.error("--artifact-version must be semantic version X.Y.Z")
    model_dir = ROOT / "models" / MODEL_ID / args.artifact_version
    manifest_dir = ROOT / "models" / MODEL_ID / args.model_version
    report_dir = pipeline_dir / "reports" / args.model_version
    args.model_dir = args.model_dir or model_dir
    args.fp32_report = args.fp32_report or report_dir / "fp32-validation.json"
    args.variant_report = args.variant_report or report_dir / "variant-validation.json"
    args.browser_report = args.browser_report or report_dir / "browser-evidence.json"
    args.output = args.output or manifest_dir / "manifest.json"
    return args


def main() -> None:
    args = parse_args()
    write_manifest(
        contract_path=args.contract.resolve(),
        fp32_report_path=args.fp32_report.resolve(),
        variant_report_path=args.variant_report.resolve(),
        browser_report_path=args.browser_report.resolve(),
        model_dir=args.model_dir.resolve(),
        output_path=args.output.resolve(),
        model_version=args.model_version,
        release_tag=args.release_tag,
    )


if __name__ == "__main__":
    main()
