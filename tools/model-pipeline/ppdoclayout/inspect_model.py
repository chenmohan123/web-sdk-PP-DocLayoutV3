from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path
from typing import Any

import torch
from transformers import AutoImageProcessor, AutoModelForObjectDetection


INPUT_NAME = "pixel_values"
INPUT_SHAPE = (1, 3, 800, 800)
SOURCE_FILES = (
    "config.json",
    "inference.yml",
    "model.safetensors",
    "preprocessor_config.json",
)
VERSION_PACKAGES = (
    "numpy",
    "onnx",
    "onnxruntime",
    "onnxscript",
    "safetensors",
    "torch",
    "torchvision",
    "transformers",
)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def tensor_metadata(value: Any) -> dict[str, Any]:
    if not isinstance(value, torch.Tensor):
        return {"pythonType": type(value).__name__}
    return {
        "dtype": str(value.dtype).removeprefix("torch."),
        "shape": list(value.shape),
    }


def json_value(value: Any) -> Any:
    if value is None or isinstance(value, (bool, float, int, str)):
        return value
    if isinstance(value, dict):
        return {str(key): json_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_value(item) for item in value]
    if hasattr(value, "__dict__"):
        return {
            key: json_value(item)
            for key, item in vars(value).items()
            if not key.startswith("_")
        }
    raise TypeError(f"Unsupported processor metadata value: {type(value).__name__}")


def processor_metadata(processor: Any) -> dict[str, Any]:
    names = (
        "do_normalize",
        "do_rescale",
        "do_resize",
        "image_mean",
        "image_std",
        "resample",
        "rescale_factor",
        "size",
    )
    return {name: json_value(getattr(processor, name)) for name in names}


def build_contract(model_path: Path) -> dict[str, Any]:
    model = AutoModelForObjectDetection.from_pretrained(
        model_path,
        local_files_only=True,
    ).eval()
    processor = AutoImageProcessor.from_pretrained(
        model_path,
        local_files_only=True,
    )

    sample = torch.linspace(0.0, 1.0, steps=torch.tensor(INPUT_SHAPE).prod().item())
    sample = sample.reshape(INPUT_SHAPE)
    with torch.inference_mode():
        result = model(pixel_values=sample)

    labels = [model.config.id2label[index] for index in range(len(model.config.id2label))]
    source_hashes = {
        name: sha256_file(model_path / name)
        for name in SOURCE_FILES
        if (model_path / name).is_file()
    }

    return {
        "architecture": type(model).__name__,
        "input": {
            "dtype": "float32",
            "name": INPUT_NAME,
            "shape": list(INPUT_SHAPE),
        },
        "labels": labels,
        "modelType": model.config.model_type,
        "outputs": {name: tensor_metadata(result[name]) for name in result.keys()},
        "parameterCount": sum(parameter.numel() for parameter in model.parameters()),
        "preprocessor": processor_metadata(processor),
        "source": {
            "files": source_hashes,
            "pathName": model_path.name,
        },
        "trainableParameterCount": sum(
            parameter.numel() for parameter in model.parameters() if parameter.requires_grad
        ),
        "versions": {
            name: importlib.metadata.version(name)
            for name in VERSION_PACKAGES
        },
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Inspect a local PP-DocLayoutV3 model")
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    contract = build_contract(args.model.resolve())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(contract, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
