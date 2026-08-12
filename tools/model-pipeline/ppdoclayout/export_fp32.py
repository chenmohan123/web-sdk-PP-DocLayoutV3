from __future__ import annotations

import argparse
from pathlib import Path

import torch
from transformers import AutoModelForObjectDetection

from ppdoclayout.export_wrapper import PPDocLayoutExportWrapper
from ppdoclayout.onnx_checks import (
    check_browser_contract,
    fold_constant_double_trig,
    run_cpu_smoke,
)


INPUT_SHAPE = (1, 3, 800, 800)
OPSET_VERSION = 18


def export_fp32(model_path: Path, output_path: Path) -> None:
    model = AutoModelForObjectDetection.from_pretrained(
        model_path,
        local_files_only=True,
    ).eval()
    wrapper = PPDocLayoutExportWrapper(model).eval()
    sample = torch.zeros(INPUT_SHAPE, dtype=torch.float32)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(
        wrapper,
        (sample,),
        output_path,
        input_names=["pixel_values"],
        output_names=list(wrapper.output_names),
        opset_version=OPSET_VERSION,
        dynamo=True,
        external_data=False,
        optimize=True,
        verify=False,
    )
    folded_nodes = fold_constant_double_trig(output_path)
    if folded_nodes != 4:
        raise ValueError(f"Expected to fold 4 constant trig nodes, folded {folded_nodes}")
    check_browser_contract(output_path)
    output_shapes = run_cpu_smoke(output_path)
    expected_shapes = [[1, 300, 25], [1, 300, 4], [1, 300, 300], [1, 300, 200, 200]]
    if output_shapes != expected_shapes:
        raise ValueError(f"Unexpected ONNX Runtime output shapes: {output_shapes}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export PP-DocLayoutV3 to FP32 ONNX")
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    export_fp32(args.model.resolve(), args.output.resolve())


if __name__ == "__main__":
    main()
