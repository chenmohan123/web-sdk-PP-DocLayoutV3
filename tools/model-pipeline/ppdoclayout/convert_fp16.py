from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import onnx
from onnx import numpy_helper
from onnxconverter_common.float16 import convert_float_to_float16

from ppdoclayout.onnx_checks import check_browser_contract, run_cpu_smoke


DEFAULT_BLOCKED_OPS = ["Resize"]


def fp32_cast_nodes(model: onnx.ModelProto) -> set[str]:
    return {
        node.name
        for node in model.graph.node
        if node.op_type == "Cast"
        and any(
            attribute.name == "to" and attribute.i == onnx.TensorProto.FLOAT
            for attribute in node.attribute
        )
    }


def convert_double_initializers_to_float(model: onnx.ModelProto) -> list[str]:
    converted_names = []
    for initializer in model.graph.initializer:
        if initializer.data_type != onnx.TensorProto.DOUBLE:
            continue
        values = numpy_helper.to_array(initializer).astype(np.float32)
        initializer.CopyFrom(numpy_helper.from_array(values, name=initializer.name))
        converted_names.append(initializer.name)
    if converted_names:
        model.graph.ClearField("value_info")
    return converted_names


def convert_fp16(
    source_path: Path, output_path: Path, blocked_ops: list[str] | None = None
) -> list[list[int]]:
    model = onnx.load(source_path, load_external_data=False)
    convert_double_initializers_to_float(model)
    converted = convert_float_to_float16(
        model,
        keep_io_types=True,
        op_block_list=DEFAULT_BLOCKED_OPS if blocked_ops is None else blocked_ops,
        node_block_list=sorted(fp32_cast_nodes(model)),
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    onnx.save_model(converted, output_path, save_as_external_data=False)
    check_browser_contract(output_path)
    return run_cpu_smoke(output_path)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Convert PP-DocLayoutV3 ONNX to FP16")
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--block-op", action="append")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    convert_fp16(
        args.source.resolve(), args.output.resolve(), blocked_ops=args.block_op
    )


if __name__ == "__main__":
    main()
