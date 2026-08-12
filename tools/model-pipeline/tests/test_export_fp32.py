from pathlib import Path

import onnx
import onnxruntime as ort
import numpy as np


MODEL_PATH = (
    Path(__file__).parents[3]
    / "models"
    / "pp-doclayoutv3"
    / "1.0.0"
    / "model-fp32.onnx"
)
EXPECTED_OUTPUTS = ["logits", "pred_boxes", "order_logits", "out_masks"]


def tensor_shape(value_info: onnx.ValueInfoProto) -> list[int]:
    return [dimension.dim_value for dimension in value_info.type.tensor_type.shape.dim]


def test_fp32_graph_has_browser_contract() -> None:
    assert MODEL_PATH.exists(), f"FP32 model has not been exported: {MODEL_PATH}"
    model = onnx.load(MODEL_PATH, load_external_data=False)
    onnx.checker.check_model(model)

    assert [value.name for value in model.graph.input] == ["pixel_values"]
    assert [value.name for value in model.graph.output] == EXPECTED_OUTPUTS
    assert tensor_shape(model.graph.input[0]) == [1, 3, 800, 800]
    assert all(not initializer.external_data for initializer in model.graph.initializer)
    used_inputs = {name for node in model.graph.node for name in node.input}
    assert [
        initializer.name
        for initializer in model.graph.initializer
        if initializer.name not in used_inputs
    ] == []


def test_fp32_graph_runs_with_onnxruntime_cpu() -> None:
    model = onnx.load(MODEL_PATH, load_external_data=False)
    double_initializers = {
        initializer.name
        for initializer in model.graph.initializer
        if initializer.data_type == onnx.TensorProto.DOUBLE
    }
    unsupported_trig = [
        node.name
        for node in model.graph.node
        if node.op_type in {"Cos", "Sin"} and node.input[0] in double_initializers
    ]
    assert unsupported_trig == []

    session = ort.InferenceSession(str(MODEL_PATH), providers=["CPUExecutionProvider"])
    outputs = session.run(
        EXPECTED_OUTPUTS,
        {"pixel_values": np.zeros((1, 3, 800, 800), dtype=np.float32)},
    )
    assert [list(output.shape) for output in outputs] == [
        [1, 300, 25],
        [1, 300, 4],
        [1, 300, 300],
        [1, 300, 200, 200],
    ]
