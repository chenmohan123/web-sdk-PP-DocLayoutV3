from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image
from transformers import AutoImageProcessor

from onnxruntime.quantization import (
    CalibrationDataReader,
    QuantFormat,
    QuantType,
    quantize_static,
)

from ppdoclayout.onnx_checks import check_browser_contract, run_cpu_smoke
from ppdoclayout.validate import sha256_file


class FixtureCalibrationReader(CalibrationDataReader):
    def __init__(self, model_path: Path, fixtures_lock: Path):
        self.processor = AutoImageProcessor.from_pretrained(
            model_path, local_files_only=True
        )
        lock = json.loads(fixtures_lock.read_text(encoding="utf-8"))
        images_dir = fixtures_lock.parent / "images"
        self.paths = []
        for fixture in lock["fixtures"]:
            image_path = images_dir / fixture["filename"]
            if sha256_file(image_path) != fixture["sha256"]:
                raise ValueError(f"Fixture integrity check failed: {image_path}")
            self.paths.append(image_path)
        self.iterator = iter(self.paths)

    def get_next(self) -> dict[str, np.ndarray] | None:
        try:
            path = next(self.iterator)
        except StopIteration:
            return None
        with Image.open(path) as opened:
            image = opened.convert("RGB")
            inputs = self.processor(images=image, return_tensors="np")
        return {"pixel_values": np.asarray(inputs["pixel_values"], dtype=np.float32)}

    def rewind(self) -> None:
        self.iterator = iter(self.paths)


def quantize_int8(
    source_path: Path,
    output_path: Path,
    model_path: Path,
    fixtures_lock: Path,
) -> list[list[int]]:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    quantize_static(
        model_input=str(source_path),
        model_output=str(output_path),
        calibration_data_reader=FixtureCalibrationReader(model_path, fixtures_lock),
        quant_format=QuantFormat.QDQ,
        activation_type=QuantType.QUInt8,
        weight_type=QuantType.QInt8,
        per_channel=True,
        extra_options={
            "ActivationSymmetric": False,
            "WeightSymmetric": True,
        },
    )
    check_browser_contract(output_path)
    return run_cpu_smoke(output_path)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Quantize PP-DocLayoutV3 to INT8 QDQ")
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--fixtures-lock", required=True, type=Path)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    quantize_int8(
        args.source.resolve(),
        args.output.resolve(),
        args.model.resolve(),
        args.fixtures_lock.resolve(),
    )


if __name__ == "__main__":
    main()
