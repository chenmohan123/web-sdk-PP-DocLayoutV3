from __future__ import annotations

import argparse
import json
from copy import deepcopy
from pathlib import Path
from typing import Any

import numpy as np
import onnxruntime as ort
import torch
from PIL import Image
from transformers import AutoImageProcessor, AutoModelForObjectDetection

from ppdoclayout.convert_fp16 import DEFAULT_BLOCKED_OPS, fp32_cast_nodes
from ppdoclayout.postprocess_reference import OUTPUT_NAMES, as_transformers_output
from ppdoclayout.validate import sha256_file, write_report


THRESHOLD = 0.5
EXPECTED_ORT_WEB_VERSION = "1.27.0"
EXPECTED_BROWSER_OUTPUTS = {
    "logits": [1, 300, 25],
    "pred_boxes": [1, 300, 4],
    "order_logits": [1, 300, 300],
    "out_masks": [1, 300, 200, 200],
}
VARIANT_THRESHOLDS = {
    "fp16": {
        "iou": 0.95,
        "matchedDetectionRatio": 0.99,
        "maxScoreDelta": 0.02,
        "meanPolygonPointDistancePixels": 2.0,
    },
    "int8": {
        "iou": 0.90,
        "matchedDetectionRatio": 0.97,
        "maxScoreDelta": 0.05,
        "meanPolygonPointDistancePixels": 4.0,
        "maxSizeRatio": 0.60,
        "minMedianWasmSpeedup": 0.10,
    },
}


def box_iou(left: np.ndarray, right: np.ndarray) -> float:
    x_min = max(float(left[0]), float(right[0]))
    y_min = max(float(left[1]), float(right[1]))
    x_max = min(float(left[2]), float(right[2]))
    y_max = min(float(left[3]), float(right[3]))
    intersection = max(0.0, x_max - x_min) * max(0.0, y_max - y_min)
    left_area = max(0.0, float(left[2] - left[0])) * max(
        0.0, float(left[3] - left[1])
    )
    right_area = max(0.0, float(right[2] - right[0])) * max(
        0.0, float(right[3] - right[1])
    )
    union = left_area + right_area - intersection
    return intersection / union if union > 0.0 else 0.0


def match_results(
    reference: dict[str, Any], candidate: dict[str, Any], minimum_iou: float
) -> list[tuple[int, int, float]]:
    reference_labels = reference["labels"].detach().cpu().numpy()
    candidate_labels = candidate["labels"].detach().cpu().numpy()
    reference_boxes = reference["boxes"].detach().cpu().numpy()
    candidate_boxes = candidate["boxes"].detach().cpu().numpy()
    possible = []
    for reference_index, reference_label in enumerate(reference_labels):
        for candidate_index, candidate_label in enumerate(candidate_labels):
            if int(reference_label) != int(candidate_label):
                continue
            iou = box_iou(
                reference_boxes[reference_index], candidate_boxes[candidate_index]
            )
            if iou >= minimum_iou:
                possible.append((reference_index, candidate_index, iou))

    matches = []
    used_reference: set[int] = set()
    used_candidate: set[int] = set()
    for reference_index, candidate_index, iou in sorted(
        possible, key=lambda item: item[2], reverse=True
    ):
        if reference_index in used_reference or candidate_index in used_candidate:
            continue
        used_reference.add(reference_index)
        used_candidate.add(candidate_index)
        matches.append((reference_index, candidate_index, iou))
    return matches


def polygon_distance(reference: Any, candidate: Any) -> float:
    reference_points = np.asarray(reference, dtype=np.float64).reshape(-1, 2)
    candidate_points = np.asarray(candidate, dtype=np.float64).reshape(-1, 2)
    if not len(reference_points) or reference_points.shape != candidate_points.shape:
        return float("inf")
    return float(np.linalg.norm(reference_points - candidate_points, axis=1).mean())


def evaluate_variant(
    model_path: Path,
    onnx_path: Path,
    fixtures_lock: Path,
    minimum_iou: float,
) -> dict[str, Any]:
    lock = json.loads(fixtures_lock.read_text(encoding="utf-8"))
    fixtures_dir = fixtures_lock.parent / "images"
    processor = AutoImageProcessor.from_pretrained(model_path, local_files_only=True)
    model = AutoModelForObjectDetection.from_pretrained(
        model_path, local_files_only=True
    ).eval()
    session = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])

    total_reference = 0
    total_candidate = 0
    total_matches = 0
    score_deltas = []
    polygon_distances = []
    fixture_reports = []
    with torch.no_grad():
        for fixture in lock["fixtures"]:
            image_path = fixtures_dir / fixture["filename"]
            if sha256_file(image_path) != fixture["sha256"]:
                raise ValueError(f"Fixture integrity check failed: {image_path}")
            with Image.open(image_path) as opened:
                image = opened.convert("RGB")
                inputs = processor(images=image, return_tensors="pt")
                official_output = model(**inputs)
                values = session.run(
                    list(OUTPUT_NAMES),
                    {"pixel_values": inputs["pixel_values"].cpu().numpy()},
                )
                candidate_output = as_transformers_output(dict(zip(OUTPUT_NAMES, values)))
                target_sizes = [image.size[::-1]]
                official = processor.post_process_object_detection(
                    official_output, threshold=THRESHOLD, target_sizes=target_sizes
                )[0]
                candidate = processor.post_process_object_detection(
                    candidate_output, threshold=THRESHOLD, target_sizes=target_sizes
                )[0]

            matches = match_results(official, candidate, minimum_iou)
            total_reference += len(official["scores"])
            total_candidate += len(candidate["scores"])
            total_matches += len(matches)
            fixture_score_deltas = []
            fixture_polygon_distances = []
            for reference_index, candidate_index, _ in matches:
                score_delta = abs(
                    float(official["scores"][reference_index])
                    - float(candidate["scores"][candidate_index])
                )
                distance = polygon_distance(
                    official["polygon_points"][reference_index],
                    candidate["polygon_points"][candidate_index],
                )
                score_deltas.append(score_delta)
                polygon_distances.append(distance)
                fixture_score_deltas.append(score_delta)
                fixture_polygon_distances.append(distance)
            fixture_reports.append(
                {
                    "filename": fixture["filename"],
                    "officialDetections": len(official["scores"]),
                    "candidateDetections": len(candidate["scores"]),
                    "matches": len(matches),
                    "maxScoreDelta": max(fixture_score_deltas, default=None),
                    "meanPolygonPointDistancePixels": _finite_mean(
                        fixture_polygon_distances
                    ),
                }
            )

    return {
        "cpu": {
            "executionStatus": "passed",
            "provider": "CPUExecutionProvider",
        },
        "officialDetections": total_reference,
        "candidateDetections": total_candidate,
        "matchedDetections": total_matches,
        "matchedDetectionRatio": (
            total_matches / total_reference if total_reference else 0.0
        ),
        "matchedDetectionPrecision": (
            total_matches / total_candidate if total_candidate else 0.0
        ),
        "unmatchedCandidateDetections": total_candidate - total_matches,
        "maxScoreDelta": max(score_deltas, default=None),
        "meanPolygonPointDistancePixels": _finite_mean(polygon_distances),
        "fixtures": fixture_reports,
    }


def build_variant_report(
    model_path: Path,
    fp32_path: Path,
    fp16_path: Path,
    accepted_variant_report_path: Path,
    fixtures_lock: Path,
    browser_evidence: dict[str, Any],
) -> dict[str, Any]:
    accepted_report = json.loads(
        accepted_variant_report_path.read_text(encoding="utf-8")
    )
    if accepted_report.get("schemaVersion") != 1:
        raise ValueError("Unsupported accepted variant report schema")
    if (
        accepted_report.get("thresholds", {}).get("int8")
        != VARIANT_THRESHOLDS["int8"]
    ):
        raise ValueError("Accepted INT8 thresholds do not match current thresholds")
    accepted_int8 = accepted_report.get("variants", {}).get("int8")
    if not isinstance(accepted_int8, dict):
        raise ValueError("Accepted INT8 validation evidence is missing")
    if (
        accepted_int8.get("pass") is not False
        or accepted_int8.get("included") is not False
    ):
        raise ValueError("Accepted INT8 evidence must remain rejected and excluded")
    int8 = deepcopy(accepted_int8)

    fp16 = evaluate_variant(
        model_path, fp16_path, fixtures_lock, VARIANT_THRESHOLDS["fp16"]["iou"]
    )
    fp32_bytes = fp32_path.stat().st_size
    fp16.update(_file_metadata(fp16_path, fp32_bytes))
    fp16["blockedOps"] = DEFAULT_BLOCKED_OPS
    import onnx

    fp16["blockedNodes"] = sorted(
        fp32_cast_nodes(onnx.load(fp32_path, load_external_data=False))
    )
    fp16["blockedOpEvidence"] = [
        {
            "opType": "Resize",
            "strategy": "preserve operator inputs and outputs as FP32",
            "withoutBlock": {
                "status": "failed",
                "stage": "onnx.shape_inference",
                "onnxVersion": onnx.__version__,
                "configuration": {"blockedOps": []},
                "nodes": [
                    "node_upsample_nearest2d_4",
                    "node_upsample_nearest2d_5",
                    "node_upsample_bilinear2d",
                    "node_upsample_bilinear2d_2",
                    "node_upsample_bilinear2d_3",
                    "node_upsample_bilinear2d_5",
                ],
                "error": "Resize scale tensor type mismatch: expected float, actual float16",
            },
        }
    ]
    fp16["browser"] = {
        "wasm": browser_evidence.get("fp16Wasm", {"status": "pending"}),
        "webgpu": browser_evidence.get("fp16Webgpu", {"status": "pending"}),
    }
    int8["browser"] = {"wasm": browser_evidence.get("int8Wasm", {"status": "pending"})}
    fp16_webgpu_errors = _browser_evidence_errors(
        fp16["browser"]["webgpu"], fp16_path, "fp16", "webgpu"
    )
    fp16_wasm_errors = _browser_evidence_errors(
        fp16["browser"]["wasm"], fp16_path, "fp16", "wasm"
    )
    fp16["browser"]["webgpu"]["validationErrors"] = fp16_webgpu_errors
    fp16["browser"]["wasm"]["validationErrors"] = fp16_wasm_errors
    fp16["pass"] = (
        _passes(fp16, "fp16")
        and not fp16_webgpu_errors
        and not fp16_wasm_errors
    )
    fp16["included"] = fp16["pass"]
    fp16["cpu"]["acceptanceStatus"] = "passed" if _passes(fp16, "fp16") else "failed"

    int8_browser_errors = _browser_evidence_errors(
        int8["browser"]["wasm"], int8_path, "int8", "wasm"
    )
    int8["browser"]["wasm"]["validationErrors"] = int8_browser_errors
    int8["pass"] = _passes(int8, "int8") and not int8_browser_errors
    int8["included"] = int8["pass"]
    int8["cpu"]["acceptanceStatus"] = "passed" if _passes(int8, "int8") else "failed"
    int8["exclusionReasons"] = [] if int8["pass"] else _exclusion_reasons(int8, "int8")

    return {
        "schemaVersion": 1,
        "threshold": THRESHOLD,
        "thresholds": VARIANT_THRESHOLDS,
        "source": {
            "fp32Sha256": sha256_file(fp32_path),
            "fixturesLockSha256": sha256_file(fixtures_lock),
        },
        "variants": {"fp16": fp16, "int8": int8},
    }


def _file_metadata(path: Path, fp32_bytes: int) -> dict[str, Any]:
    size = path.stat().st_size
    return {
        "filename": path.name,
        "bytes": size,
        "sha256": sha256_file(path),
        "sizeRatio": size / fp32_bytes,
    }


def _finite_mean(values: list[float]) -> float | None:
    finite = [value for value in values if np.isfinite(value)]
    return float(np.mean(finite)) if finite else None


def _passes(report: dict[str, Any], precision: str) -> bool:
    thresholds = VARIANT_THRESHOLDS[precision]
    quality = bool(
        report["matchedDetectionRatio"] >= thresholds["matchedDetectionRatio"]
        and report["matchedDetectionPrecision"]
        >= thresholds["matchedDetectionRatio"]
        and report["maxScoreDelta"] is not None
        and report["maxScoreDelta"] <= thresholds["maxScoreDelta"]
        and report["meanPolygonPointDistancePixels"] is not None
        and report["meanPolygonPointDistancePixels"]
        <= thresholds["meanPolygonPointDistancePixels"]
    )
    if precision == "int8":
        quality = quality and (
            report["sizeRatio"] <= thresholds["maxSizeRatio"]
            or report.get("medianWasmSpeedup", 0.0)
            >= thresholds["minMedianWasmSpeedup"]
        )
    return quality


def _browser_evidence_errors(
    evidence: dict[str, Any], model_path: Path, precision: str, backend: str
) -> list[str]:
    if backend not in {"wasm", "webgpu"}:
        raise ValueError(f"Unsupported browser validation backend: {backend}")
    if evidence.get("status") != "passed":
        return [f"browser {backend} validation did not pass"]

    errors = []
    if evidence.get("executionProvider") != backend:
        errors.append(f"browser execution provider is not {backend}")
    if evidence.get("modelBytes") != model_path.stat().st_size:
        errors.append("browser evidence model size does not match artifact")
    if evidence.get("modelSha256") != sha256_file(model_path):
        errors.append("browser evidence model SHA-256 does not match artifact")
    if evidence.get("onnxruntimeWebVersion") != EXPECTED_ORT_WEB_VERSION:
        errors.append("browser evidence ONNX Runtime Web version does not match")
    if precision == "fp16" and backend == "webgpu":
        if "shader-f16" not in evidence.get("adapterFeatures", []):
            errors.append("browser adapter does not report shader-f16")
    if precision == "fp16":
        outputs = evidence.get("outputs", {})
        if set(outputs) != set(EXPECTED_BROWSER_OUTPUTS):
            errors.append("browser output names do not match model contract")
        for name, dimensions in EXPECTED_BROWSER_OUTPUTS.items():
            output = outputs.get(name, {})
            if output.get("dimensions") != dimensions or output.get("type") != "float32":
                errors.append(f"browser output contract mismatch for {name}")
            if output.get("allFinite") is not True:
                errors.append(f"browser output contains non-finite values for {name}")
            digest = output.get("sha256", "")
            if len(digest) != 64 or any(
                character not in "0123456789abcdef" for character in digest
            ):
                errors.append(f"browser output digest is invalid for {name}")
    return errors


def _exclusion_reasons(report: dict[str, Any], precision: str) -> list[str]:
    thresholds = VARIANT_THRESHOLDS[precision]
    reasons = []
    if report["matchedDetectionRatio"] < thresholds["matchedDetectionRatio"]:
        reasons.append(
            f"matched detection ratio {report['matchedDetectionRatio']:.6f} is below {thresholds['matchedDetectionRatio']}"
        )
    if report["matchedDetectionPrecision"] < thresholds["matchedDetectionRatio"]:
        reasons.append(
            f"matched detection precision {report['matchedDetectionPrecision']:.6f} is below {thresholds['matchedDetectionRatio']}"
        )
    if report["maxScoreDelta"] is None or report["maxScoreDelta"] > thresholds["maxScoreDelta"]:
        reasons.append("score delta acceptance failed")
    if (
        report["meanPolygonPointDistancePixels"] is None
        or report["meanPolygonPointDistancePixels"]
        > thresholds["meanPolygonPointDistancePixels"]
    ):
        reasons.append("polygon distance acceptance failed")
    if precision == "int8" and (
        report["sizeRatio"] > thresholds["maxSizeRatio"]
        and report.get("medianWasmSpeedup", 0.0)
        < thresholds["minMedianWasmSpeedup"]
    ):
        reasons.append("INT8 size and WASM speed acceptance failed")
    browser_keys = ("webgpu", "wasm") if precision == "fp16" else ("wasm",)
    for browser_key in browser_keys:
        reasons.extend(report["browser"][browser_key].get("validationErrors", []))
    return reasons


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate optimized ONNX variants")
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--fp32", required=True, type=Path)
    parser.add_argument("--fp16", required=True, type=Path)
    parser.add_argument("--accepted-variant-report", required=True, type=Path)
    parser.add_argument("--fixtures-lock", required=True, type=Path)
    parser.add_argument("--browser-evidence", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    evidence = (
        json.loads(args.browser_evidence.read_text(encoding="utf-8"))
        if args.browser_evidence
        else {}
    )
    report = build_variant_report(
        args.model.resolve(),
        args.fp32.resolve(),
        args.fp16.resolve(),
        args.accepted_variant_report.resolve(),
        args.fixtures_lock.resolve(),
        evidence,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    write_report(args.output, report)
    if not report["variants"]["fp16"]["pass"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
