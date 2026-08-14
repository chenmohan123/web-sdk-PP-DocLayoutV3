from __future__ import annotations

import argparse
import hashlib
import os
import tempfile
from pathlib import Path

import numpy as np
import onnx
from onnx import TensorProto, numpy_helper


POSITIONAL_NAMES = ("sin", "cos", "sin_1", "cos_1")
POSITIONAL_SHAPE = [625, 64]
KNOWN_LIVE_DOUBLE_NAMES = {*POSITIONAL_NAMES, "cat_7"}
# The exporter left these unreferenced value_info entries behind.
KNOWN_ORPHAN_DOUBLE_VALUE_INFO = {"mul_241", "mul_242"}
RECOMPUTED_DOUBLE_VALUE_INFO = {*POSITIONAL_NAMES, "cat_7"}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _node(model: onnx.ModelProto, name: str) -> onnx.NodeProto:
    matches = [node for node in model.graph.node if node.name == name]
    if len(matches) != 1:
        raise ValueError(f"Expected exactly one {name} node")
    return matches[0]


def _require_source_contract(model: onnx.ModelProto) -> None:
    doubles = {
        value.name: value
        for value in model.graph.initializer
        if value.data_type == TensorProto.DOUBLE
    }
    if set(doubles) != set(POSITIONAL_NAMES):
        unexpected = sorted(set(doubles) - set(POSITIONAL_NAMES))
        raise ValueError(
            f"Expected exactly {list(POSITIONAL_NAMES)} DOUBLE initializers; "
            f"unexpected DOUBLE initializer(s): {unexpected}"
        )
    for name in POSITIONAL_NAMES:
        if list(doubles[name].dims) != POSITIONAL_SHAPE:
            raise ValueError(f"{name} must have shape {POSITIONAL_SHAPE}")

    concat = _node(model, "node_cat_7")
    axis = next((item.i for item in concat.attribute if item.name == "axis"), None)
    if (
        concat.op_type != "Concat"
        or list(concat.input) != list(POSITIONAL_NAMES)
        or list(concat.output) != ["cat_7"]
        or axis != 1
    ):
        raise ValueError(
            "node_cat_7 must Concat the four positional constants to cat_7 on axis 1"
        )

    cast = _node(model, "node__to_copy_4")
    cast_to = next((item.i for item in cast.attribute if item.name == "to"), None)
    if (
        cast.op_type != "Cast"
        or list(cast.input) != ["cat_7"]
        or list(cast.output) != ["_to_copy_4"]
        or cast_to != TensorProto.FLOAT
    ):
        raise ValueError("node__to_copy_4 must Cast cat_7 to FLOAT as _to_copy_4")


def _double_names(model: onnx.ModelProto) -> list[str]:
    values = [*model.graph.input, *model.graph.output, *model.graph.value_info]
    names = [
        value.name
        for value in values
        if value.type.tensor_type.elem_type == TensorProto.DOUBLE
    ]
    names.extend(
        value.name
        for value in model.graph.initializer
        if value.data_type == TensorProto.DOUBLE
    )
    return sorted(set(names))


def _validate_source(model: onnx.ModelProto) -> None:
    _require_source_contract(model)
    onnx.checker.check_model(model)
    if any(value.external_data for value in model.graph.initializer):
        raise ValueError("Source model must be self-contained")
    inferred = onnx.shape_inference.infer_shapes(model, strict_mode=True)
    doubles = set(_double_names(inferred))
    live_names = {
        name
        for node in model.graph.node
        for name in [*node.input, *node.output]
        if name
    }
    live_names.update(value.name for value in model.graph.initializer)
    live_names.update(value.name for value in [*model.graph.input, *model.graph.output])
    live_doubles = doubles & live_names
    orphan_doubles = doubles - live_names
    if live_doubles != KNOWN_LIVE_DOUBLE_NAMES:
        unexpected = sorted(live_doubles - KNOWN_LIVE_DOUBLE_NAMES)
        missing = sorted(KNOWN_LIVE_DOUBLE_NAMES - live_doubles)
        raise ValueError(
            "Source graph live DOUBLE values do not match the known positional path; "
            f"unexpected={unexpected}, missing={missing}"
        )
    if not orphan_doubles <= KNOWN_ORPHAN_DOUBLE_VALUE_INFO:
        unexpected = sorted(orphan_doubles - KNOWN_ORPHAN_DOUBLE_VALUE_INFO)
        raise ValueError(f"Source graph contains unexpected orphan DOUBLE values: {unexpected}")
    by_name = {value.name: value for value in inferred.graph.value_info}
    for name in orphan_doubles:
        shape = [
            dimension.dim_value
            for dimension in by_name[name].type.tensor_type.shape.dim
        ]
        if shape != POSITIONAL_SHAPE:
            raise ValueError(f"Orphan DOUBLE value {name} must have shape {POSITIONAL_SHAPE}")


def _remove_recomputed_double_metadata(model: onnx.ModelProto) -> None:
    live_names = {
        name
        for node in model.graph.node
        for name in [*node.input, *node.output]
        if name
    }
    retained = [
        value
        for value in model.graph.value_info
        if not (
            value.type.tensor_type.elem_type == TensorProto.DOUBLE
            and (
                value.name in RECOMPUTED_DOUBLE_VALUE_INFO
                or (
                    value.name in KNOWN_ORPHAN_DOUBLE_VALUE_INFO
                    and value.name not in live_names
                )
            )
        )
    ]
    del model.graph.value_info[:]
    model.graph.value_info.extend(retained)


def sanitize_webgpu_fp32(source: Path, output: Path) -> dict[str, int | str]:
    source = source.resolve()
    output = output.resolve()
    model = onnx.load(source, load_external_data=False)
    _validate_source(model)
    _remove_recomputed_double_metadata(model)

    for index, value in enumerate(model.graph.initializer):
        if value.name not in POSITIONAL_NAMES:
            continue
        converted = numpy_helper.from_array(
            numpy_helper.to_array(value).astype(np.float32), name=value.name
        )
        model.graph.initializer[index].CopyFrom(converted)

    inferred = onnx.shape_inference.infer_shapes(model, strict_mode=True)
    onnx.checker.check_model(inferred)
    remaining = _double_names(inferred)
    if remaining:
        raise ValueError(f"Sanitized graph still contains DOUBLE values: {remaining}")

    output.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{output.name}.", suffix=".tmp", dir=output.parent
    )
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(inferred.SerializeToString(deterministic=True))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary_name, output)
    except BaseException:
        Path(temporary_name).unlink(missing_ok=True)
        raise
    return {"bytes": output.stat().st_size, "sha256": sha256_file(output)}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Sanitize PP-DocLayoutV3 FP32 for WebGPU"
    )
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    result = sanitize_webgpu_fp32(args.source, args.output)
    print(f"{args.output}: {result['bytes']} bytes sha256={result['sha256']}")


if __name__ == "__main__":
    main()
