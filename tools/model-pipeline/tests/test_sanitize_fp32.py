from __future__ import annotations

import hashlib
from pathlib import Path

import numpy as np
import onnx
import pytest
from onnx import TensorProto, helper, numpy_helper

from ppdoclayout.sanitize_fp32 import (
    POSITIONAL_NAMES,
    _double_names,
    sanitize_webgpu_fp32,
)


ROOT = Path(__file__).parents[3]
SOURCE_FP32 = ROOT / "models" / "pp-doclayoutv3" / "1.0.0" / "model-fp32.onnx"


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def initializer_hashes(
    model: onnx.ModelProto, excluded: set[str]
) -> dict[str, str]:
    return {
        value.name: hashlib.sha256(
            value.SerializeToString(deterministic=True)
        ).hexdigest()
        for value in model.graph.initializer
        if value.name not in excluded
    }


def source_model(*, extra_double: bool = False, cast_to: int = TensorProto.FLOAT) -> onnx.ModelProto:
    initializers = [
        numpy_helper.from_array(
            np.arange(625 * 64, dtype=np.float64).reshape(625, 64), name=name
        )
        for name in POSITIONAL_NAMES
    ]
    initializers.append(
        numpy_helper.from_array(np.asarray([3.25], dtype=np.float32), name="learned_weight")
    )
    if extra_double:
        initializers.append(
            numpy_helper.from_array(np.asarray([1.0], dtype=np.float64), name="unexpected")
        )
    nodes = [
        helper.make_node(
            "Concat", POSITIONAL_NAMES, ["cat_7"], axis=1, name="node_cat_7"
        ),
        helper.make_node(
            "Cast", ["cat_7"], ["_to_copy_4"], to=cast_to, name="node__to_copy_4"
        ),
        helper.make_node(
            "Add", ["input", "learned_weight"], ["output"], name="learned_add"
        ),
    ]
    graph = helper.make_graph(
        nodes,
        "sanitize-test",
        [helper.make_tensor_value_info("input", TensorProto.FLOAT, [1])],
        [helper.make_tensor_value_info("output", TensorProto.FLOAT, [1])],
        initializers,
    )
    return helper.make_model(graph, opset_imports=[helper.make_opsetid("", 18)])


def write_source(path: Path, model: onnx.ModelProto) -> None:
    path.write_bytes(model.SerializeToString(deterministic=True))


def replace_first_initializer_with_wrong_shape(model: onnx.ModelProto) -> None:
    model.graph.initializer[0].CopyFrom(
        numpy_helper.from_array(
            np.zeros((624, 64), dtype=np.float64), name=POSITIONAL_NAMES[0]
        )
    )


def test_converts_only_known_positional_constants(tmp_path: Path) -> None:
    source = tmp_path / "source.onnx"
    output = tmp_path / "output.onnx"
    write_source(source, source_model())

    result = sanitize_webgpu_fp32(source, output)

    model = onnx.load(output, load_external_data=False)
    by_name = {value.name: value for value in model.graph.initializer}
    assert all(by_name[name].data_type == TensorProto.FLOAT for name in POSITIONAL_NAMES)
    assert by_name["learned_weight"].raw_data == np.asarray([3.25], dtype=np.float32).tobytes()
    assert result == {"bytes": output.stat().st_size, "sha256": sha256_file(output)}


def test_rejects_missing_positional_initializer(tmp_path: Path) -> None:
    source = tmp_path / "source.onnx"
    output = tmp_path / "output.onnx"
    model = source_model()
    del model.graph.initializer[0]
    del model.graph.node[0].input[0]
    write_source(source, model)

    with pytest.raises(ValueError, match="exactly"):
        sanitize_webgpu_fp32(source, output)

    assert not output.exists()


def test_rejects_renamed_positional_initializer(tmp_path: Path) -> None:
    source = tmp_path / "source.onnx"
    output = tmp_path / "output.onnx"
    model = source_model()
    model.graph.initializer[0].name = "renamed"
    model.graph.node[0].input[0] = "renamed"
    write_source(source, model)

    with pytest.raises(ValueError, match="exactly"):
        sanitize_webgpu_fp32(source, output)

    assert not output.exists()


def test_rejects_wrong_shape_positional_initializer(tmp_path: Path) -> None:
    source = tmp_path / "source.onnx"
    output = tmp_path / "output.onnx"
    model = source_model()
    replace_first_initializer_with_wrong_shape(model)
    write_source(source, model)

    with pytest.raises(ValueError, match="shape"):
        sanitize_webgpu_fp32(source, output)

    assert not output.exists()


def test_rejects_renamed_concat_node(tmp_path: Path) -> None:
    source = tmp_path / "source.onnx"
    output = tmp_path / "output.onnx"
    model = source_model()
    model.graph.node[0].name = "other_concat"
    write_source(source, model)

    with pytest.raises(ValueError, match="node_cat_7"):
        sanitize_webgpu_fp32(source, output)

    assert not output.exists()


def test_rejects_wrong_concat_topology(tmp_path: Path) -> None:
    source = tmp_path / "source.onnx"
    output = tmp_path / "output.onnx"
    model = source_model()
    model.graph.node[0].input[0], model.graph.node[0].input[1] = (
        model.graph.node[0].input[1],
        model.graph.node[0].input[0],
    )
    write_source(source, model)

    with pytest.raises(ValueError, match="Concat"):
        sanitize_webgpu_fp32(source, output)

    assert not output.exists()


def test_rejects_renamed_cast_node(tmp_path: Path) -> None:
    source = tmp_path / "source.onnx"
    output = tmp_path / "output.onnx"
    model = source_model()
    model.graph.node[1].name = "other_cast"
    write_source(source, model)

    with pytest.raises(ValueError, match="node__to_copy_4"):
        sanitize_webgpu_fp32(source, output)

    assert not output.exists()


def test_rejects_wrong_cast_topology(tmp_path: Path) -> None:
    source = tmp_path / "source.onnx"
    output = tmp_path / "output.onnx"
    model = source_model()
    model.graph.node[1].input[0] = "input"
    write_source(source, model)

    with pytest.raises(ValueError, match="Cast"):
        sanitize_webgpu_fp32(source, output)

    assert not output.exists()


def test_rejects_cast_target_other_than_float(tmp_path: Path) -> None:
    source = tmp_path / "source.onnx"
    output = tmp_path / "output.onnx"
    write_source(source, source_model(cast_to=TensorProto.FLOAT16))

    with pytest.raises(ValueError, match="FLOAT"):
        sanitize_webgpu_fp32(source, output)

    assert not output.exists()


def test_rejects_any_additional_double_initializer(tmp_path: Path) -> None:
    source = tmp_path / "source.onnx"
    output = tmp_path / "output.onnx"
    write_source(source, source_model(extra_double=True))

    with pytest.raises(ValueError, match="unexpected DOUBLE initializer"):
        sanitize_webgpu_fp32(source, output)

    assert not output.exists()


def test_is_byte_reproducible(tmp_path: Path) -> None:
    source = tmp_path / "source.onnx"
    first = tmp_path / "first.onnx"
    second = tmp_path / "second.onnx"
    write_source(source, source_model())

    sanitize_webgpu_fp32(source, first)
    sanitize_webgpu_fp32(source, second)

    assert first.read_bytes() == second.read_bytes()


def test_real_model_preserves_contract_and_learned_parameters(tmp_path: Path) -> None:
    output = tmp_path / "model-fp32.onnx"
    sanitize_webgpu_fp32(SOURCE_FP32, output)
    source = onnx.load(SOURCE_FP32, load_external_data=False)
    candidate = onnx.load(output, load_external_data=False)

    assert [(item.domain, item.version) for item in candidate.opset_import] == [
        ("", 18)
    ]
    assert [value.SerializeToString() for value in candidate.graph.input] == [
        value.SerializeToString() for value in source.graph.input
    ]
    assert [value.SerializeToString() for value in candidate.graph.output] == [
        value.SerializeToString() for value in source.graph.output
    ]
    assert initializer_hashes(candidate, set(POSITIONAL_NAMES)) == initializer_hashes(
        source, set(POSITIONAL_NAMES)
    )
    inferred = onnx.shape_inference.infer_shapes(candidate, strict_mode=True)
    assert not _double_names(inferred)
