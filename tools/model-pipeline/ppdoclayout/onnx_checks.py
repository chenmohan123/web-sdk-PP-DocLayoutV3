from __future__ import annotations

from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
from onnx import numpy_helper


def tensor_shape(value_info: onnx.ValueInfoProto) -> list[int]:
    return [dimension.dim_value for dimension in value_info.type.tensor_type.shape.dim]


def fold_constant_double_trig(path: Path) -> int:
    model = onnx.load(path, load_external_data=False)
    initializers = {
        initializer.name: initializer for initializer in model.graph.initializer
    }
    replacement_initializers: list[onnx.TensorProto] = []
    kept_nodes: list[onnx.NodeProto] = []
    folded_sources: set[str] = set()

    for node in model.graph.node:
        source = initializers.get(node.input[0]) if node.input else None
        if (
            node.op_type not in {"Cos", "Sin"}
            or source is None
            or source.data_type != onnx.TensorProto.DOUBLE
        ):
            kept_nodes.append(node)
            continue

        values = numpy_helper.to_array(source)
        result = np.cos(values) if node.op_type == "Cos" else np.sin(values)
        replacement_initializers.append(numpy_helper.from_array(result, node.output[0]))
        folded_sources.add(source.name)

    if not replacement_initializers:
        return 0

    del model.graph.node[:]
    model.graph.node.extend(kept_nodes)
    used_inputs = {name for node in kept_nodes for name in node.input}
    removable_sources = folded_sources - used_inputs
    retained_initializers = [
        initializer
        for initializer in model.graph.initializer
        if initializer.name not in removable_sources
    ]
    del model.graph.initializer[:]
    model.graph.initializer.extend(retained_initializers)
    model.graph.initializer.extend(replacement_initializers)
    onnx.save_model(model, path, save_as_external_data=False)
    return len(replacement_initializers)


def run_cpu_smoke(path: Path) -> list[list[int]]:
    session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    outputs = session.run(
        ["logits", "pred_boxes", "order_logits", "out_masks"],
        {"pixel_values": np.zeros((1, 3, 800, 800), dtype=np.float32)},
    )
    return [list(output.shape) for output in outputs]


def check_browser_contract(path: Path) -> None:
    model = onnx.load(path, load_external_data=False)
    onnx.checker.check_model(model)
    onnx.shape_inference.infer_shapes(model, strict_mode=True)

    input_names = [value.name for value in model.graph.input]
    if input_names != ["pixel_values"]:
        raise ValueError(f"Unexpected ONNX inputs: {input_names}")
    if tensor_shape(model.graph.input[0]) != [1, 3, 800, 800]:
        raise ValueError("ONNX input shape must be fixed at [1, 3, 800, 800]")

    expected_outputs = ["logits", "pred_boxes", "order_logits", "out_masks"]
    output_names = [value.name for value in model.graph.output]
    if output_names != expected_outputs:
        raise ValueError(f"Unexpected ONNX outputs: {output_names}")
    if any(initializer.external_data for initializer in model.graph.initializer):
        raise ValueError("Browser model must not use ONNX external data")
