from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import importlib.util
import json
import platform
import re
from pathlib import Path
from typing import Any

import numpy as np
import onnxruntime as ort
import torch
from PIL import Image
from transformers import AutoImageProcessor, AutoModelForObjectDetection

from ppdoclayout.postprocess_reference import (
    OUTPUT_NAMES,
    as_transformers_output,
    compare_postprocessed,
    tensor_metrics,
)


THRESHOLD = 0.5
PARITY_THRESHOLDS = {
    "boxCoordinateDeltaPixels": 1.0,
    "polygonCoordinateDeltaPixels": 1.5,
    "scoreDelta": 0.001,
}


def canonical_json(value: Any) -> str:
    rendered = json.dumps(value, indent=2, sort_keys=True)
    return re.sub(r"e([+-])0+(\d+)", r"e\1\2", rendered) + "\n"


def write_report(path: Path, report: dict[str, Any]) -> None:
    path.write_text(canonical_json(report), encoding="utf-8", newline="\n")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_fp32(
    model_path: Path, onnx_path: Path, fixtures_lock: Path
) -> dict[str, Any]:
    lock = json.loads(fixtures_lock.read_text(encoding="utf-8"))
    fixtures_dir = fixtures_lock.parent / "images"
    fixtures = _verified_fixtures(lock, fixtures_dir)

    processor = AutoImageProcessor.from_pretrained(
        model_path, local_files_only=True
    )
    model = AutoModelForObjectDetection.from_pretrained(
        model_path, local_files_only=True
    ).eval()
    session = ort.InferenceSession(
        str(onnx_path), providers=["CPUExecutionProvider"]
    )

    fixture_reports = []
    with torch.no_grad():
        for fixture, image_path in fixtures:
            with Image.open(image_path) as opened:
                image = opened.convert("RGB")
                inputs = processor(images=image, return_tensors="pt")
                official_output = model(**inputs)
                onnx_values = session.run(
                    list(OUTPUT_NAMES),
                    {"pixel_values": inputs["pixel_values"].cpu().numpy()},
                )
                onnx_outputs = dict(zip(OUTPUT_NAMES, onnx_values))
                target_sizes = [image.size[::-1]]
                official_result = processor.post_process_object_detection(
                    official_output,
                    threshold=THRESHOLD,
                    target_sizes=target_sizes,
                )[0]
                onnx_result = processor.post_process_object_detection(
                    as_transformers_output(onnx_outputs),
                    threshold=THRESHOLD,
                    target_sizes=target_sizes,
                )[0]

            comparison = compare_postprocessed(official_result, onnx_result)
            raw_metrics = {
                name: tensor_metrics(
                    getattr(official_output, name).detach().cpu().numpy(),
                    onnx_outputs[name],
                )
                for name in OUTPUT_NAMES
            }
            comparison.update(
                {
                    "filename": fixture["filename"],
                    "sha256": fixture["sha256"],
                    "width": fixture["width"],
                    "height": fixture["height"],
                    "rawOutputs": raw_metrics,
                }
            )
            comparison["pass"] = _fixture_passes(comparison)
            fixture_reports.append(comparison)

    return {
        "schemaVersion": 1,
        "threshold": THRESHOLD,
        "thresholds": PARITY_THRESHOLDS,
        "sourceHashes": {
            "modelSafetensors": sha256_file(model_path / "model.safetensors"),
            "onnx": sha256_file(onnx_path),
        },
        "environment": _environment(),
        "paddleReference": _paddle_status(),
        "fixtures": fixture_reports,
        "overallPass": all(item["pass"] for item in fixture_reports),
    }


def _verified_fixtures(
    lock: dict[str, Any], fixtures_dir: Path
) -> list[tuple[dict[str, Any], Path]]:
    verified = []
    for fixture in lock["fixtures"]:
        path = fixtures_dir / fixture["filename"]
        if sha256_file(path) != fixture["sha256"]:
            raise ValueError(f"Fixture integrity check failed: {path}")
        with Image.open(path) as image:
            if list(image.size) != [fixture["width"], fixture["height"]]:
                raise ValueError(f"Fixture dimensions do not match lock: {path}")
        verified.append((fixture, path))
    return verified


def _fixture_passes(report: dict[str, Any]) -> bool:
    return bool(
        report["labelSequenceEqual"]
        and report["readingOrderEqual"]
        and not report["unmatchedOfficial"]
        and not report["unmatchedOnnx"]
        and report["maxScoreDelta"] <= PARITY_THRESHOLDS["scoreDelta"]
        and report["maxBoxCoordinateDeltaPixels"]
        <= PARITY_THRESHOLDS["boxCoordinateDeltaPixels"]
        and report["maxPolygonCoordinateDeltaPixels"]
        <= PARITY_THRESHOLDS["polygonCoordinateDeltaPixels"]
    )


def _environment() -> dict[str, str]:
    packages = ["numpy", "onnxruntime", "opencv-python-headless", "torch", "transformers"]
    return {
        "python": platform.python_version(),
        "platform": platform.platform(),
        **{name: importlib.metadata.version(name) for name in packages},
    }


def _paddle_status() -> dict[str, str]:
    if importlib.util.find_spec("paddle") is None:
        return {
            "status": "unavailable",
            "reason": "PaddlePaddle is not installed in the isolated Python 3.11 environment",
        }
    return {
        "status": "available-not-compared",
        "reason": "Paddle runtime is installed; run the separate official Paddle validation before release",
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate FP32 ONNX parity")
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--onnx", required=True, type=Path)
    parser.add_argument("--fixtures-lock", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    report = validate_fp32(
        args.model.resolve(), args.onnx.resolve(), args.fixtures_lock.resolve()
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    write_report(args.output, report)
    if not report["overallPass"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
