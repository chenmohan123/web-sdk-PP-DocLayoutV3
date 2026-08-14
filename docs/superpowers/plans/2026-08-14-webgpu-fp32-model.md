# WebGPU FP32 Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish an immutable PP-DocLayoutV3 `1.0.1` model whose FP32 graph runs strictly on WebGPU and WASM, then adopt it as the default model in SDK `1.0.5` and the Demo.

**Architecture:** Phase 1 adds a fail-closed ONNX sanitizer, versioned validation evidence, a generated `1.0.1` manifest, and an immutable `v1.0.1-models` release without changing SDK `1.0.4`. Phase 2 starts only after those URLs are public, switches the SDK and Pages defaults to model `1.0.1`, enables strict GPU + FP32 selection in the Demo, synchronizes documentation, and prepares SDK `1.0.5`.

**Tech Stack:** Python 3.11, ONNX, ONNX Runtime CPU, TypeScript, ONNX Runtime Web 1.27.0, React, Vitest, Playwright, Node.js test runner, GitHub Actions, Git LFS, pnpm 11.16.0

---

## File Map

Phase 1 creates or changes these ownership units:

- `tools/model-pipeline/ppdoclayout/sanitize_fp32.py`: guarded, deterministic DOUBLE-to-FLOAT transform for the four positional constants only.
- `tools/model-pipeline/tests/test_sanitize_fp32.py`: synthetic-graph unit tests plus real-model structural and reproducibility checks.
- `tools/model-pipeline/ppdoclayout/validate.py`: accepted-versus-candidate FP32 raw-output and seven-fixture parity evidence.
- `tools/model-pipeline/tests/test_parity_fp32.py`: report-contract and slow real-model parity tests.
- `tests/browser/benchmark.spec.ts`: strict seven-fixture browser runner for `wasm-fp32`, `webgpu-fp16`, and `webgpu-fp32`.
- `.github/workflows/benchmark.yml`: hosted WASM and physical-adapter WebGPU validation jobs.
- `tools/model-pipeline/ppdoclayout/build_manifest.py`: version/release parameters and browser-evidence gates.
- `tools/model-pipeline/tests/test_manifest.py`: versioned generation and fail-closed evidence tests.
- `models/pp-doclayoutv3/1.0.1/`: sanitized FP32, byte-identical accepted FP16, and generated manifest.
- `tools/model-pipeline/reports/1.0.1/`: candidate FP32, variant, and browser evidence without rewriting historical reports.
- `scripts/verify-release.mjs`, `scripts/verify-release.test.mjs`: version-aware local/release asset verification.
- `.github/workflows/model-validation.yml`: explicit immutable `v1.0.1-models` publication workflow.
- `models/README.md`, `docs/en/conversion.md`, `docs/zh-CN/conversion.md`: transform provenance and model-phase release instructions.

Phase 2 changes these consumer units only after `v1.0.1-models` is public:

- `packages/sdk/src/detector.ts`: default Pages manifest URL `models/v1.0.1/manifest.json`.
- `packages/sdk/src/model/manifest.ts`, `packages/sdk/package.json`, `pnpm-lock.yaml`: SDK version `1.0.5`.
- `packages/sdk/tests/detector.test.ts`, `packages/sdk/tests/manifest.test.ts`, `packages/sdk/tests/runtime-selector.test.ts`: default manifest and strict WebGPU FP32 selection contracts.
- `apps/demo/src/execution-preferences.ts`, `apps/demo/src/i18n/en.ts`, `apps/demo/src/i18n/zh-CN.ts`, `apps/demo/tests/demo.spec.ts`: enabled GPU + FP32 control with strict manual semantics.
- `scripts/stage-pages-models.mjs`, `scripts/verify-release.mjs`, `scripts/verify-release.test.mjs`: Pages `v1.0.1` staging and SDK release contract.
- `README.md`, `README.en.md`, `packages/sdk/README.md`, `docs/en/api.md`, `docs/en/compatibility.md`, `docs/en/models.md`, `docs/en/performance.md`, `docs/zh-CN/api.md`, `docs/zh-CN/compatibility.md`, `docs/zh-CN/models.md`, `docs/zh-CN/performance.md`, `CHANGELOG.md`: bilingual support and release documentation.

## Phase 1: Model Asset `1.0.1`

### Task 1: Specify the guarded FP32 sanitizer

**Files:**
- Create: `tools/model-pipeline/tests/test_sanitize_fp32.py`
- Create later: `tools/model-pipeline/ppdoclayout/sanitize_fp32.py`

- [ ] **Step 1: Add synthetic graph fixtures and failing transform tests**

Create `tools/model-pipeline/tests/test_sanitize_fp32.py` with helpers that build the exact known topology and assertions for valid and invalid inputs:

```python
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


POSITIONAL_NAMES = ("sin", "cos", "sin_1", "cos_1")


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


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


@pytest.mark.parametrize(
    ("mutation", "message"),
    [
        (lambda model: setattr(model.graph.initializer[0], "name", "renamed"), "exactly"),
        (replace_first_initializer_with_wrong_shape, "shape"),
        (lambda model: setattr(model.graph.node[0], "name", "other_concat"), "node_cat_7"),
        (lambda model: setattr(model.graph.node[1].attribute[0], "i", TensorProto.FLOAT16), "FLOAT"),
    ],
)
def test_rejects_unexpected_source_contract(tmp_path: Path, mutation, message: str) -> None:
    source = tmp_path / "source.onnx"
    output = tmp_path / "output.onnx"
    model = source_model()
    mutation(model)
    write_source(source, model)

    with pytest.raises(ValueError, match=message):
        sanitize_webgpu_fp32(source, output)

    assert not output.exists()


def test_rejects_any_additional_double_value(tmp_path: Path) -> None:
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
```

- [ ] **Step 2: Run the sanitizer tests and verify the RED state**

Run:

```powershell
.\.venv-model\Scripts\python.exe -m pytest tools/model-pipeline/tests/test_sanitize_fp32.py -q
```

Expected: collection fails with `ModuleNotFoundError: No module named 'ppdoclayout.sanitize_fp32'`.

- [ ] **Step 3: Commit the executable specification**

```powershell
git add -- tools/model-pipeline/tests/test_sanitize_fp32.py
git commit -m "test(models): specify WebGPU FP32 sanitizer"
```

### Task 2: Implement and materialize the deterministic sanitizer

**Files:**
- Create: `tools/model-pipeline/ppdoclayout/sanitize_fp32.py`
- Modify: `tools/model-pipeline/tests/test_sanitize_fp32.py`
- Create: `models/pp-doclayoutv3/1.0.1/model-fp32.onnx`
- Create: `models/pp-doclayoutv3/1.0.1/model-fp16.onnx`

- [ ] **Step 1: Implement the fail-closed transform**

Create `tools/model-pipeline/ppdoclayout/sanitize_fp32.py` with this public contract and guarded transform:

```python
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
    if concat.op_type != "Concat" or list(concat.input) != list(POSITIONAL_NAMES):
        raise ValueError("node_cat_7 must concatenate the four positional constants")
    if list(concat.output) != ["cat_7"]:
        raise ValueError("node_cat_7 must produce cat_7")
    axis = next((item.i for item in concat.attribute if item.name == "axis"), None)
    if axis != 1:
        raise ValueError("node_cat_7 must concatenate on axis 1")

    cast = _node(model, "node__to_copy_4")
    cast_to = next((item.i for item in cast.attribute if item.name == "to"), None)
    if (
        cast.op_type != "Cast"
        or list(cast.input) != ["cat_7"]
        or list(cast.output) != ["_to_copy_4"]
        or cast_to != TensorProto.FLOAT
    ):
        raise ValueError("node__to_copy_4 must Cast cat_7 to FLOAT")


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


def sanitize_webgpu_fp32(source: Path, output: Path) -> dict[str, int | str]:
    source = source.resolve()
    output = output.resolve()
    model = onnx.load(source, load_external_data=False)
    onnx.checker.check_model(model)
    if any(value.external_data for value in model.graph.initializer):
        raise ValueError("Source model must be self-contained")
    _require_source_contract(model)

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
    parser = argparse.ArgumentParser(description="Sanitize PP-DocLayoutV3 FP32 for WebGPU")
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    result = sanitize_webgpu_fp32(args.source, args.output)
    print(f"{args.output}: {result['bytes']} bytes sha256={result['sha256']}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run unit tests and verify the GREEN state**

Run:

```powershell
.\.venv-model\Scripts\python.exe -m pytest tools/model-pipeline/tests/test_sanitize_fp32.py -q
```

Expected: all synthetic sanitizer tests pass, including atomic failure behavior and byte reproducibility.

- [ ] **Step 3: Add real-model invariants before generating the artifact**

Append a slow-free structural test that reads the checked-in source graph, sanitizes it in a temporary directory, and asserts the exact graph boundary and unchanged learned initializer hashes:

```python
ROOT = Path(__file__).parents[3]
SOURCE_FP32 = ROOT / "models" / "pp-doclayoutv3" / "1.0.0" / "model-fp32.onnx"


def initializer_hashes(model: onnx.ModelProto, excluded: set[str]) -> dict[str, str]:
    return {
        value.name: hashlib.sha256(value.SerializeToString(deterministic=True)).hexdigest()
        for value in model.graph.initializer
        if value.name not in excluded
    }


def test_real_model_preserves_contract_and_learned_parameters(tmp_path: Path) -> None:
    output = tmp_path / "model-fp32.onnx"
    sanitize_webgpu_fp32(SOURCE_FP32, output)
    source = onnx.load(SOURCE_FP32, load_external_data=False)
    candidate = onnx.load(output, load_external_data=False)

    assert [(item.domain, item.version) for item in candidate.opset_import] == [("", 18)]
    assert [value.SerializeToString() for value in candidate.graph.input] == [
        value.SerializeToString() for value in source.graph.input
    ]
    assert [value.SerializeToString() for value in candidate.graph.output] == [
        value.SerializeToString() for value in source.graph.output
    ]
    assert initializer_hashes(candidate, set(POSITIONAL_NAMES)) == initializer_hashes(
        source, set(POSITIONAL_NAMES)
    )
    assert not _double_names(onnx.shape_inference.infer_shapes(candidate, strict_mode=True))
```

- [ ] **Step 4: Materialize both `1.0.1` models**

Run:

```powershell
.\.venv-model\Scripts\python.exe -m ppdoclayout.sanitize_fp32 --source models/pp-doclayoutv3/1.0.0/model-fp32.onnx --output models/pp-doclayoutv3/1.0.1/model-fp32.onnx
New-Item -ItemType Directory -Force models/pp-doclayoutv3/1.0.1 | Out-Null
Copy-Item -LiteralPath models/pp-doclayoutv3/1.0.0/model-fp16.onnx -Destination models/pp-doclayoutv3/1.0.1/model-fp16.onnx
```

Expected: the sanitizer prints the candidate byte count and SHA-256; the FP16 copy succeeds.

- [ ] **Step 5: Verify reproducibility and immutable source hashes**

Run:

```powershell
$regen = Join-Path $env:TEMP 'ppdoclayout-model-fp32-1.0.1.onnx'
.\.venv-model\Scripts\python.exe -m ppdoclayout.sanitize_fp32 --source models/pp-doclayoutv3/1.0.0/model-fp32.onnx --output $regen
Get-FileHash -Algorithm SHA256 models/pp-doclayoutv3/1.0.1/model-fp32.onnx,$regen
Get-FileHash -Algorithm SHA256 models/pp-doclayoutv3/1.0.0/model-fp16.onnx,models/pp-doclayoutv3/1.0.1/model-fp16.onnx
Remove-Item -LiteralPath $regen
```

Expected: both FP32 hashes match each other; both FP16 hashes equal `463ba56faa555baf84271b4002b33b0c5fcc50776fe4f39344235eccb72073f2`; the source FP32 remains `fc2eebdc2153ad4e6993766f914f78f47a737fed123a78731bc9c57f7a6c806b`.

- [ ] **Step 6: Commit the sanitizer and versioned binaries**

```powershell
git add -- tools/model-pipeline/ppdoclayout/sanitize_fp32.py tools/model-pipeline/tests/test_sanitize_fp32.py models/pp-doclayoutv3/1.0.1/model-fp32.onnx models/pp-doclayoutv3/1.0.1/model-fp16.onnx
git commit -m "feat(models): sanitize FP32 graph for WebGPU"
```

### Task 3: Bind seven-fixture FP32 parity to accepted and candidate models

**Files:**
- Modify: `tools/model-pipeline/ppdoclayout/validate.py`
- Modify: `tools/model-pipeline/tests/test_parity_fp32.py`
- Create after validation: `tools/model-pipeline/reports/1.0.1/fp32-validation.json`

- [ ] **Step 1: Write failing report-contract tests**

Extend the import in `tools/model-pipeline/tests/test_parity_fp32.py` to include `sha256_file`, then make `validate_fp32` receive `accepted_onnx_path` and bind both ONNX files:

```python
from ppdoclayout.validate import canonical_json, sha256_file, validate_fp32, write_report
```

Replace the existing slow test with:

```python
@pytest.mark.slow
def test_sanitized_fp32_matches_accepted_fp32_and_official_transformers() -> None:
    accepted = ROOT / "models" / "pp-doclayoutv3" / "1.0.0" / "model-fp32.onnx"
    candidate = ROOT / "models" / "pp-doclayoutv3" / "1.0.1" / "model-fp32.onnx"
    report = validate_fp32(
        model_path=Path(r"E:\models\PP-DocLayoutV3_safetensors"),
        accepted_onnx_path=accepted,
        onnx_path=candidate,
        fixtures_lock=ROOT / "tools" / "model-pipeline" / "fixtures" / "fixtures.lock.json",
    )

    assert report["overallPass"] is True
    assert report["sourceHashes"] == {
        "acceptedOnnx": sha256_file(accepted),
        "modelSafetensors": sha256_file(
            Path(r"E:\models\PP-DocLayoutV3_safetensors\model.safetensors")
        ),
        "onnx": sha256_file(candidate),
    }
    assert len(report["fixtures"]) == 7
    for fixture in report["fixtures"]:
        assert fixture["acceptedDetectionCount"] == fixture["onnxDetectionCount"]
        assert fixture["acceptedLabelSequenceEqual"] is True
        assert fixture["acceptedReadingOrderEqual"] is True
        assert fixture["rawOutputs"]["allBitIdentical"] is True
        assert fixture["pass"] is True
```

- [ ] **Step 2: Run the slow test and verify the RED state**

Run:

```powershell
.\.venv-model\Scripts\python.exe -m pytest tools/model-pipeline/tests/test_parity_fp32.py -m slow -q
```

Expected: FAIL because `validate_fp32()` does not accept `accepted_onnx_path` and the report has no accepted-model or raw-output fields.

- [ ] **Step 3: Extend validation without relaxing existing thresholds**

In `tools/model-pipeline/ppdoclayout/validate.py`:

1. Add `accepted_onnx_path: Path` to `validate_fp32`.
2. Create an ONNX Runtime CPU session for both accepted and candidate files using `providers=["CPUExecutionProvider"]`.
3. Feed the identical preprocessed tensor to both sessions for every locked fixture.
4. For each output name, record shape, dtype, byte SHA-256, `bitIdentical`, and maximum absolute delta.
5. Postprocess accepted and candidate results with the same existing processor and thresholds.
6. Add `acceptedDetectionCount`, `acceptedLabelSequenceEqual`, and `acceptedReadingOrderEqual`.
7. Keep `PARITY_THRESHOLDS` exactly `scoreDelta=0.001`, `boxCoordinateDeltaPixels=1.0`, and `polygonCoordinateDeltaPixels=1.5`.
8. Require accepted detection count, label sequence, and reading order equality in `_fixture_passes`.
9. Prefer bit identity by recording it; if a platform produces non-bit-identical outputs, the existing numerical thresholds remain the only permitted tolerance.
10. Add CLI option `--accepted-onnx` and bind `sourceHashes.acceptedOnnx`.

Use this exact raw-output summary shape:

```python
raw_outputs = {
    name: {
        "acceptedSha256": hashlib.sha256(accepted_value.tobytes()).hexdigest(),
        "candidateSha256": hashlib.sha256(candidate_value.tobytes()).hexdigest(),
        "bitIdentical": bool(np.array_equal(accepted_value, candidate_value)),
        "dtype": str(candidate_value.dtype),
        "maxAbsoluteDelta": float(np.max(np.abs(accepted_value - candidate_value))),
        "shape": list(candidate_value.shape),
    }
    for name, accepted_value, candidate_value in zip(
        output_names, accepted_outputs, candidate_outputs, strict=True
    )
}
fixture_report["rawOutputs"] = {
    "allBitIdentical": all(item["bitIdentical"] for item in raw_outputs.values()),
    "outputs": raw_outputs,
}
```

- [ ] **Step 4: Run focused unit and slow parity tests**

Run:

```powershell
.\.venv-model\Scripts\python.exe -m pytest tools/model-pipeline/tests/test_parity_fp32.py -q
```

Expected: all seven fixtures pass; counts, label sequences, and reading order match; raw output evidence is populated. If `allBitIdentical` is false, inspect the per-output deltas and stop if any existing threshold is exceeded.

- [ ] **Step 5: Generate the versioned FP32 report**

Run:

```powershell
.\.venv-model\Scripts\python.exe -m ppdoclayout.validate --model E:\models\PP-DocLayoutV3_safetensors --accepted-onnx models/pp-doclayoutv3/1.0.0/model-fp32.onnx --onnx models/pp-doclayoutv3/1.0.1/model-fp32.onnx --fixtures-lock tools/model-pipeline/fixtures/fixtures.lock.json --output tools/model-pipeline/reports/1.0.1/fp32-validation.json
```

Expected: exit zero and `overallPass: true`; `sourceHashes.acceptedOnnx` is the historical FP32 hash and `sourceHashes.onnx` is the sanitized artifact hash.

- [ ] **Step 6: Commit candidate parity code and evidence**

```powershell
git add -- tools/model-pipeline/ppdoclayout/validate.py tools/model-pipeline/tests/test_parity_fp32.py tools/model-pipeline/reports/1.0.1/fp32-validation.json
git commit -m "test(models): validate sanitized FP32 parity"
```

### Task 4: Run strict seven-fixture browser WASM and physical WebGPU validation

**Files:**
- Modify: `tests/browser/benchmark.spec.ts`
- Modify: `.github/workflows/benchmark.yml`
- Modify: `scripts/benchmark-contract.test.mjs`
- Create after browser runs: `tools/model-pipeline/reports/1.0.1/browser-evidence.json`

- [ ] **Step 1: Write failing benchmark contract assertions**

Update `scripts/benchmark-contract.test.mjs` to require a third hardware job and all seven fixture records:

```js
assert.match(workflow, /PPDOCLAYOUT_BENCHMARK_MODE:\s*["']?webgpu-fp32/);
assert.match(workflow, /name:\s*benchmark-webgpu-fp32/);
assert.match(workflow, /runs-on:\s*\[self-hosted, windows, x64, webgpu-hardware\]/);

for (const name of ["wasm-fp32.json", "webgpu-fp32.json"]) {
  const report = readJson(name, "1.0.1");
  assert.equal(report.status, "passed");
  assert.equal(report.fallbacks.length, 0);
  assert.equal(report.fixtures.length, 7);
  assert.ok(report.fixtures.every((fixture) => fixture.parity === "passed"));
}
```

Change `readJson` to accept the model version:

```js
function readJson(name, version = "1.0.0") {
  const path = join(repositoryRoot, "benchmarks", version, name);
  assert.ok(existsSync(path), `missing benchmark artifact: benchmarks/${version}/${name}`);
  return JSON.parse(readFileSync(path, "utf8"));
}
```

- [ ] **Step 2: Run the benchmark contract and verify the RED state**

Run:

```powershell
pnpm benchmark:test
```

Expected: FAIL because `webgpu-fp32` is not an accepted mode/job and `benchmarks/1.0.1` evidence is absent.

- [ ] **Step 3: Generalize the browser benchmark to model `1.0.1` and seven fixtures**

In `tests/browser/benchmark.spec.ts`:

- set `modelRoot` to `models/pp-doclayoutv3/1.0.1` when the mode is `wasm-fp32` or `webgpu-fp32`;
- accept `wasm-fp32`, `webgpu-fp16`, and `webgpu-fp32`;
- use Chrome for both WebGPU modes;
- derive precision with `mode.endsWith("fp32") ? "fp32" : "fp16"`;
- keep `allowFallback: false` and assert `runtime.fallbacks` is empty;
- read `fixtures.lock.json`, verify each fixture SHA-256 in Node, run all seven images, and record one detection/parity/timing/output evidence object per fixture;
- record `browser.version()`, user agent, `platform()`/`release()`, adapter identity, sorted adapter features, ORT `1.27.0`, model size/hash, session creation/load timings, and SDK commit;
- write `test-results/benchmark/${mode}.json`.

Keep these fields at the report top level so manifest generation can validate evidence without interpreting presentation-specific nesting:

```ts
const report = {
  schemaVersion: 1,
  status: "passed",
  executionProvider: backend,
  precision,
  fallbacks: result.runtime.fallbacks,
  modelBytes: result.model.bytes,
  modelSha256: result.model.sha256,
  onnxruntimeWebVersion: "1.27.0",
  adapter: result.adapter,
  adapterFeatures: result.adapterFeatures,
  browser: { name: "Chromium", version: browser.version(), userAgent: result.browser },
  operatingSystem: `${platform()} ${release()}`,
  fixtures: result.fixtures,
  timingsMs: result.timings,
  sdkCommit
};
```

The strict browser-side assertion must be:

```ts
expect(result.runtime).toMatchObject({ backend, fallbacks: [], precision });
expect(result.model.sha256).toBe(manifestVariant.sha256);
expect(result.fixtures).toHaveLength(fixturesLock.fixtures.length);
for (const fixture of result.fixtures) {
  expect(fixture.detectionCount).toBe(fixture.expectedDetectionCount);
  expect(fixture.labelSequenceEqual).toBe(true);
  expect(fixture.readingOrderEqual).toBe(true);
  expect(fixture.parity).toBe("passed");
}
```

The report must include a stable hash of every complete detection result as output evidence, not only counts and timings:

```ts
async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

const detectionJson = JSON.stringify(detection.detections);
const outputSha256 = await sha256(new TextEncoder().encode(detectionJson));
return {
  detectionCount: detection.detections.length,
  labelSequenceEqual,
  outputSha256,
  parity: "passed",
  readingOrderEqual,
  timings: detection.timings
};
```

- [ ] **Step 4: Add hosted WASM and physical WebGPU FP32 jobs**

In `.github/workflows/benchmark.yml`, keep the existing jobs and add the physical adapter job:

```yaml
  webgpu-fp32:
    runs-on: [self-hosted, windows, x64, webgpu-hardware]
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v7
        with:
          lfs: true
      - uses: pnpm/action-setup@v6
        with:
          version: 11.16.0
      - uses: actions/setup-node@v7
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install chromium
      - run: pnpm exec playwright test tests/browser/benchmark.spec.ts
        env:
          PPDOCLAYOUT_BENCHMARK_MODE: webgpu-fp32
      - uses: actions/upload-artifact@v7
        with:
          name: benchmark-webgpu-fp32
          path: test-results/benchmark/webgpu-fp32.json
```

Change the hosted `wasm-fp32` job to run the generalized seven-fixture test against `1.0.1`. Preserve `allowFallback: false` in the test; do not emulate WebGPU with a software adapter.

- [ ] **Step 5: Run strict WASM FP32 locally**

Run:

```powershell
$env:PPDOCLAYOUT_BENCHMARK_MODE = 'wasm-fp32'
pnpm exec playwright test tests/browser/benchmark.spec.ts --project=chromium
Remove-Item Env:PPDOCLAYOUT_BENCHMARK_MODE
```

Expected: exit zero, seven fixture entries, `runtime.backend: "wasm"`, `runtime.precision: "fp32"`, and `fallbacks: []` in `test-results/benchmark/wasm-fp32.json`.

- [ ] **Step 6: Run strict FP32 on the physical WebGPU adapter**

Run on the hardware-tagged Windows machine or dispatch the benchmark workflow:

```powershell
$env:PPDOCLAYOUT_BENCHMARK_MODE = 'webgpu-fp32'
pnpm exec playwright test tests/browser/benchmark.spec.ts --project=chromium
Remove-Item Env:PPDOCLAYOUT_BENCHMARK_MODE
```

Expected: session creation succeeds without `node__to_copy_4` provider errors; all seven fixtures pass; `runtime.backend: "webgpu"`, `runtime.precision: "fp32"`, and `fallbacks: []`; adapter identity/features and per-fixture timings/output hashes are present. Any failure stops Task 4 and prevents WebGPU from being added to the manifest.

- [ ] **Step 7: Persist versioned browser evidence**

Create `tools/model-pipeline/reports/1.0.1/browser-evidence.json` from the two successful reports with this stable envelope:

```json
{
  "schemaVersion": 1,
  "fp16Webgpu": {},
  "fp32Wasm": {},
  "fp32Webgpu": {}
}
```

Copy `fp16Webgpu` byte-for-byte as a JSON value from `tools/model-pipeline/reports/browser-evidence.json`; the FP16 artifact is byte-identical and its accepted hardware evidence remains valid. The FP32 values are the complete generated `wasm-fp32.json` and `webgpu-fp32.json` objects. Copy the same two FP32 reports to `benchmarks/1.0.1/wasm-fp32.json` and `benchmarks/1.0.1/webgpu-fp32.json`; do not hand-edit measured values.

- [ ] **Step 8: Run the benchmark contract and commit evidence**

Run:

```powershell
pnpm benchmark:test
```

Expected: PASS with both version `1.0.1` strict FP32 reports accepted.

```powershell
git add -- tests/browser/benchmark.spec.ts .github/workflows/benchmark.yml scripts/benchmark-contract.test.mjs benchmarks/1.0.1 tools/model-pipeline/reports/1.0.1/browser-evidence.json
git commit -m "test(models): validate FP32 in browser runtimes"
```

### Task 5: Generate a gated model `1.0.1` manifest

**Files:**
- Modify: `tools/model-pipeline/ppdoclayout/build_manifest.py`
- Modify: `tools/model-pipeline/tests/test_manifest.py`
- Modify: `tools/model-pipeline/ppdoclayout/variant_validation.py`
- Modify: `tools/model-pipeline/tests/test_variants.py`
- Create after generation: `tools/model-pipeline/reports/1.0.1/variant-validation.json`
- Create after generation: `models/pp-doclayoutv3/1.0.1/manifest.json`

- [ ] **Step 1: Write failing version and evidence-gate tests**

Refactor `tools/model-pipeline/tests/test_manifest.py` so paths and expected hashes are derived from generated files under `1.0.1`, then add:

```python
MODEL_VERSION = "1.0.1"
RELEASE_TAG = "v1.0.1-models"
MODEL_DIR = ROOT / "models" / "pp-doclayoutv3" / MODEL_VERSION
BROWSER_REPORT_PATH = PIPELINE_DIR / "reports" / MODEL_VERSION / "browser-evidence.json"


def test_fp32_requires_strict_wasm_and_webgpu_evidence(tmp_path: Path) -> None:
    evidence = json.loads(BROWSER_REPORT_PATH.read_text(encoding="utf-8"))
    evidence["fp32Webgpu"]["fallbacks"] = [{"provider": "wasm"}]
    path = tmp_path / "browser-evidence.json"
    path.write_text(json.dumps(evidence), encoding="utf-8")

    with pytest.raises(ValueError, match="fallback"):
        build_from_paths(browser_report_path=path)


def test_manifest_advertises_validated_fp32_for_both_backends() -> None:
    manifest = build_from_paths()
    fp32 = next(item for item in manifest["variants"] if item["id"] == "fp32")

    assert manifest["model"]["version"] == MODEL_VERSION
    assert manifest["variantPriority"] == ["fp16", "fp32"]
    assert fp32["backendCompatibility"] == ["wasm", "webgpu"]
    assert fp32["url"].endswith(f"/{RELEASE_TAG}/model-fp32.onnx")
```

- [ ] **Step 2: Run focused tests and verify the RED state**

Run:

```powershell
.\.venv-model\Scripts\python.exe -m pytest tools/model-pipeline/tests/test_manifest.py tools/model-pipeline/tests/test_variants.py -q
```

Expected: FAIL because manifest generation is fixed to `1.0.0` and does not consume FP32 browser evidence.

- [ ] **Step 3: Parameterize manifest identity and enforce evidence**

Change `build_manifest` and `write_manifest` to require `model_version`, `release_tag`, and `browser_report_path`. Remove `MODEL_VERSION` and `RELEASE_BASE_URL` module constants; retain `MODEL_ID` and `MIN_SDK_VERSION`.

Build the release URL with validated values:

```python
SEMVER = re.compile(r"^\d+\.\d+\.\d+$")


def release_base_url(model_version: str, release_tag: str) -> str:
    if not SEMVER.fullmatch(model_version):
        raise ValueError(f"Invalid model version: {model_version}")
    if release_tag != f"v{model_version}-models":
        raise ValueError("Release tag must match model version")
    return (
        "https://github.com/chenmohan123/web-sdk-PP-DocLayoutV3/"
        f"releases/download/{release_tag}/"
    )
```

Require both browser entries to have:

- `status == "passed"`;
- `executionProvider` equal to `wasm` or `webgpu` respectively;
- `precision == "fp32"`;
- `fallbacks == []`;
- model byte size and SHA-256 equal to the candidate;
- ORT version `1.27.0`;
- exactly seven passing fixtures with valid output hashes;
- WebGPU adapter identity and feature list.

Only after both checks pass, emit:

```python
"backendCompatibility": ["wasm", "webgpu"]
```

Use versioned validation links in the generated manifest:

```python
"validation": {
    "included": True,
    "pass": True,
    "report": f"tools/model-pipeline/reports/{model_version}/fp32-validation.json",
}
```

Apply the equivalent versioned path to FP16 variant validation. Default `--model-dir`, `--fp32-report`, `--variant-report`, `--browser-report`, and `--output` paths must all derive from `--model-version`; no `1.0.0` path remains embedded in the generator.

Add CLI flags with fixed safe defaults:

```python
parser.add_argument("--model-version", default="1.0.1")
parser.add_argument("--release-tag", default="v1.0.1-models")
parser.add_argument(
    "--browser-report",
    type=Path,
    default=pipeline_dir / "reports" / "1.0.1" / "browser-evidence.json",
)
```

- [ ] **Step 4: Version variant validation and preserve FP16 bytes**

Update `variant_validation.py` so the accepted FP16 artifact is re-evaluated from `models/pp-doclayoutv3/1.0.1/model-fp16.onnx` while `source.fp32Sha256` binds the candidate. Replace the required `--int8` argument with required `--accepted-variant-report`: load the historical report, require its INT8 entry to have `pass: false` and `included: false`, and carry that exclusion evidence forward without requiring the intentionally unpublished INT8 binary. Read `fp16Webgpu` from the versioned browser evidence and keep every existing FP16/INT8 numerical threshold unchanged. In `test_variants.py`, assert:

```python
OLD_FP16 = ROOT / "models" / "pp-doclayoutv3" / "1.0.0" / "model-fp16.onnx"
NEW_FP16 = ROOT / "models" / "pp-doclayoutv3" / "1.0.1" / "model-fp16.onnx"


def test_model_1_0_1_reuses_accepted_fp16_bytes() -> None:
    assert NEW_FP16.read_bytes() == OLD_FP16.read_bytes()


def test_rejected_int8_evidence_is_carried_forward_without_binary() -> None:
    accepted = json.loads(
        (ROOT / "tools" / "model-pipeline" / "reports" / "variant-validation.json")
        .read_text(encoding="utf-8")
    )["variants"]["int8"]
    assert accepted["pass"] is False
    assert accepted["included"] is False
```

- [ ] **Step 5: Generate candidate variant evidence and manifest**

Run the versioned variant command with the accepted FP16 artifact and historical rejected-INT8 evidence, then generate the manifest:

```powershell
.\.venv-model\Scripts\python.exe -m ppdoclayout.variant_validation --model E:\models\PP-DocLayoutV3_safetensors --fp32 models/pp-doclayoutv3/1.0.1/model-fp32.onnx --fp16 models/pp-doclayoutv3/1.0.1/model-fp16.onnx --accepted-variant-report tools/model-pipeline/reports/variant-validation.json --fixtures-lock tools/model-pipeline/fixtures/fixtures.lock.json --browser-evidence tools/model-pipeline/reports/1.0.1/browser-evidence.json --output tools/model-pipeline/reports/1.0.1/variant-validation.json
.\.venv-model\Scripts\python.exe -m ppdoclayout.build_manifest --model-version 1.0.1 --release-tag v1.0.1-models --model-dir models/pp-doclayoutv3/1.0.1 --fp32-report tools/model-pipeline/reports/1.0.1/fp32-validation.json --variant-report tools/model-pipeline/reports/1.0.1/variant-validation.json --browser-report tools/model-pipeline/reports/1.0.1/browser-evidence.json --output models/pp-doclayoutv3/1.0.1/manifest.json
```

Expected manifest: version `1.0.1`, `minSdkVersion: "1.0.0"`, priority `fp16` then `fp32`, FP16 WebGPU only, FP32 WASM and WebGPU. The carried INT8 record stays excluded and no INT8 file is published.

- [ ] **Step 6: Run model generator tests and commit**

```powershell
.\.venv-model\Scripts\python.exe -m pytest tools/model-pipeline/tests/test_manifest.py tools/model-pipeline/tests/test_variants.py -q
git add -- tools/model-pipeline/ppdoclayout/build_manifest.py tools/model-pipeline/ppdoclayout/variant_validation.py tools/model-pipeline/tests/test_manifest.py tools/model-pipeline/tests/test_variants.py tools/model-pipeline/reports/1.0.1/variant-validation.json models/pp-doclayoutv3/1.0.1/manifest.json
git commit -m "feat(models): generate validated model 1.0.1 manifest"
```

Expected: all tests pass and the checked-in manifest is byte-identical to `canonical_json(build_manifest(...))`.

### Task 6: Make model verification and publication version-aware and immutable

**Files:**
- Modify: `scripts/verify-release.mjs`
- Modify: `scripts/verify-release.test.mjs`
- Modify: `.github/workflows/model-validation.yml`

- [ ] **Step 1: Write failing release-contract tests**

Add tests in `scripts/verify-release.test.mjs` for versioned model verification and immutable workflow behavior:

```js
test("verifies model 1.0.1 without changing the SDK 1.0.4 default", () => {
  const output = execFileSync(
    process.execPath,
    [resolve(repositoryRoot, "scripts/verify-release.mjs"), "--models", "1.0.1"],
    { cwd: repositoryRoot, encoding: "utf8" }
  );
  assert.match(output, /model 1\.0\.1/);
});

test("creates the immutable model release without clobber", () => {
  const workflow = readFileSync(
    resolve(repositoryRoot, ".github/workflows/model-validation.yml"),
    "utf8"
  );
  assert.match(workflow, /model_version:[\s\S]*default:\s*["']?1\.0\.1/);
  assert.match(workflow, /release_tag:[\s\S]*default:\s*["']?v1\.0\.1-models/);
  assert.match(workflow, /gh release create/);
  assert.doesNotMatch(workflow, /--clobber/);
});
```

- [ ] **Step 2: Run release tests and verify the RED state**

Run:

```powershell
pnpm release:test
```

Expected: FAIL because `--models` accepts no version and the workflow uploads to `v1.0.0-models` with `--clobber`.

- [ ] **Step 3: Parameterize local model verification**

In `scripts/verify-release.mjs`, parse `--models <version>`, validate `/^\d+\.\d+\.\d+$/`, load `models/pp-doclayoutv3/<version>/manifest.json`, and derive reports from `tools/model-pipeline/reports/<version>/`. For `1.0.1`, additionally require:

```js
if (browser.fp32Wasm?.status !== "passed") fail("strict FP32 WASM evidence is missing");
if (browser.fp32Webgpu?.status !== "passed") fail("strict FP32 WebGPU evidence is missing");
if (browser.fp32Wasm?.fallbacks?.length !== 0) fail("FP32 WASM evidence contains fallback");
if (browser.fp32Webgpu?.fallbacks?.length !== 0) fail("FP32 WebGPU evidence contains fallback");
if (manifestVariants.fp32?.backendCompatibility.join(",") !== "wasm,webgpu") {
  fail("FP32 manifest compatibility must be wasm,webgpu");
}
```

Keep `node scripts/verify-release.mjs --models 1.0.0` able to verify historical assets. During Phase 1, `--static` must continue treating `1.0.0` as the SDK default.

- [ ] **Step 4: Replace mutable upload with explicit release creation**

Change `.github/workflows/model-validation.yml` inputs to `model_version`, `release_tag`, and `upload_assets`. Validate `release_tag == v${model_version}-models`, pass the version to the verifier, and upload versioned reports/artifacts. Use a creation step that refuses an existing release:

```yaml
      - name: Create immutable model release
        shell: bash
        run: |
          set -euo pipefail
          if gh release view "${RELEASE_TAG}" >/dev/null 2>&1; then
            echo "Release ${RELEASE_TAG} already exists; immutable assets will not be overwritten." >&2
            exit 1
          fi
          gh release create "${RELEASE_TAG}" \
            "models/pp-doclayoutv3/${MODEL_VERSION}/manifest.json" \
            "models/pp-doclayoutv3/${MODEL_VERSION}/model-fp16.onnx" \
            "models/pp-doclayoutv3/${MODEL_VERSION}/model-fp32.onnx" \
            "tools/model-pipeline/reports/${MODEL_VERSION}/browser-evidence.json" \
            "tools/model-pipeline/reports/${MODEL_VERSION}/fp32-validation.json" \
            "tools/model-pipeline/reports/${MODEL_VERSION}/variant-validation.json" \
            --target main \
            --title "PP-DocLayoutV3 model ${MODEL_VERSION}" \
            --notes "Immutable PP-DocLayoutV3 ${MODEL_VERSION} browser model assets."
        env:
          GH_TOKEN: ${{ github.token }}
          MODEL_VERSION: ${{ inputs.model_version }}
          RELEASE_TAG: ${{ inputs.release_tag }}
```

The upload job remains gated by `inputs.upload_assets`; default workflow permissions stay read-only and only the upload job gets `contents: write`.

- [ ] **Step 5: Run release and action syntax checks**

```powershell
pnpm release:test
pnpm exec prettier --check .github/workflows/model-validation.yml
node scripts/verify-release.mjs --models 1.0.0
node scripts/verify-release.mjs --models 1.0.1
```

Expected: all commands pass; historical and new model assets verify independently.

- [ ] **Step 6: Commit publication safeguards**

```powershell
git add -- scripts/verify-release.mjs scripts/verify-release.test.mjs .github/workflows/model-validation.yml
git commit -m "ci(models): publish versioned immutable assets"
```

### Task 7: Document and verify the model asset phase

**Files:**
- Modify: `models/README.md`
- Modify: `docs/en/conversion.md`
- Modify: `docs/zh-CN/conversion.md`
- Modify: `scripts/check-doc-parity.test.mjs`

- [ ] **Step 1: Add failing documentation provenance checks**

In `scripts/check-doc-parity.test.mjs`, require both language documents and the model README to contain:

```js
for (const document of [modelReadme, englishConversion, chineseConversion]) {
  assert.match(document, /1\.0\.1/);
  assert.match(document, /v1\.0\.1-models/);
  assert.match(document, /sin.*cos.*sin_1.*cos_1/s);
  assert.match(document, /625.*64/s);
  assert.match(document, /FP64.*不支持|FP64.*not supported/is);
}
```

- [ ] **Step 2: Run docs tests and verify the RED state**

```powershell
pnpm docs:test
```

Expected: FAIL because model `1.0.1` and its sanitation provenance are not documented.

- [ ] **Step 3: Add exact provenance and reproduction commands**

Document these facts in Chinese and English:

- upstream `torch_dtype` is float32; this is not FP64 inference;
- source FP32 hash is `fc2eebdc2153ad4e6993766f914f78f47a737fed123a78731bc9c57f7a6c806b`;
- only `sin`, `cos`, `sin_1`, `cos_1`, each DOUBLE `[625, 64]`, are converted to FLOAT before the existing FLOAT Cast;
- learned initializers and graph input/output contract are unchanged;
- model `1.0.1` is validated on seven licensed fixtures in strict browser WASM and physical WebGPU;
- FP16 is byte-identical to the accepted `1.0.0` FP16 hash;
- the reproduction command is the sanitizer invocation from Task 2;
- historical `v1.0.0-models` assets remain immutable.

- [ ] **Step 4: Run the complete Phase 1 verification**

```powershell
.\.venv-model\Scripts\python.exe -m pytest tools/model-pipeline -q
pnpm docs:test
pnpm benchmark:test
pnpm release:test
pnpm lint
pnpm typecheck
pnpm build
git diff --check
node scripts/verify-release.mjs --models 1.0.1
```

Expected: every command exits zero. Confirm `packages/sdk/src/detector.ts` still points to `models/v1.0.0/manifest.json` and `packages/sdk/package.json` is still `1.0.4`.

- [ ] **Step 5: Commit model-phase documentation**

```powershell
git add -- models/README.md docs/en/conversion.md docs/zh-CN/conversion.md scripts/check-doc-parity.test.mjs
git commit -m "docs(models): record FP32 sanitation evidence"
```

- [ ] **Step 6: Merge the model asset phase only after review**

Open a PR containing Tasks 1-7. Review the artifact hashes, all seven fixture reports, physical adapter identity, exact manifest URLs, and the absence of SDK default changes. Do not merge the SDK adoption changes in this PR.

### Checkpoint A: Explicit confirmation before publishing `v1.0.1-models`

- [ ] **Wait for the user to explicitly confirm model release publication**

After the Phase 1 PR is merged to `main`, show the user:

- the merged commit;
- sanitized FP32 byte count and SHA-256;
- FP16 byte count and SHA-256;
- WASM and physical WebGPU seven-fixture summaries;
- exact release tag `v1.0.1-models`;
- confirmation that the workflow creates a new release and cannot clobber it.

Only after an explicit confirmation, dispatch `.github/workflows/model-validation.yml` with:

```text
model_version = 1.0.1
release_tag = v1.0.1-models
upload_assets = true
```

- [ ] **Verify every public immutable URL before Phase 2**

Run:

```powershell
gh release view v1.0.1-models --json tagName,isDraft,isPrerelease,assets,url
$urls = @(
  'https://github.com/chenmohan123/web-sdk-PP-DocLayoutV3/releases/download/v1.0.1-models/manifest.json',
  'https://github.com/chenmohan123/web-sdk-PP-DocLayoutV3/releases/download/v1.0.1-models/model-fp16.onnx',
  'https://github.com/chenmohan123/web-sdk-PP-DocLayoutV3/releases/download/v1.0.1-models/model-fp32.onnx'
)
foreach ($url in $urls) { (Invoke-WebRequest -Method Head -Uri $url).StatusCode }
```

Expected: release is public and not draft; every URL returns HTTP 200. Download the three assets to a temporary directory and compare byte size/SHA-256 with the checked-in manifest before starting Task 8.

## Phase 2: SDK `1.0.5` Adoption

### Task 8: Switch the SDK default and lock WebGPU FP32 selection behavior

**Files:**
- Modify: `packages/sdk/tests/detector.test.ts`
- Modify: `packages/sdk/tests/manifest.test.ts`
- Modify: `packages/sdk/tests/runtime-selector.test.ts`
- Modify: `packages/sdk/src/detector.ts`

- [ ] **Step 1: Write failing SDK adoption tests**

Change SDK test fixtures to load `models/pp-doclayoutv3/1.0.1/manifest.json`. In `detector.test.ts`, expect:

```ts
expect(DEFAULT_MANIFEST_URL).toBe(
  "https://chenmohan123.github.io/web-sdk-PP-DocLayoutV3/models/v1.0.1/manifest.json"
);
```

In `manifest.test.ts`, require FP32 compatibility and release URL:

```ts
expect(manifest.model.version).toBe("1.0.1");
expect(manifest.minSdkVersion).toBe("1.0.0");
expect(manifest.variants.find(({ id }) => id === "fp32")).toMatchObject({
  backendCompatibility: ["wasm", "webgpu"],
  precision: "fp32",
  url: "https://github.com/chenmohan123/web-sdk-PP-DocLayoutV3/releases/download/v1.0.1-models/model-fp32.onnx"
});
```

In `runtime-selector.test.ts`, add explicit and automatic contracts:

```ts
it("uses WebGPU FP32 when WebGPU exists without shader-f16", () => {
  const plan = selectExecutionPlan(
    {},
    capabilities({ webgpu: true, webgpuFp16: false }),
    manifest.variants
  );
  expect(plan.selected).toMatchObject({ provider: "webgpu", precision: "fp32" });
});

it("keeps explicit WebGPU FP32 strict", () => {
  const plan = selectExecutionPlan(
    { allowFallback: false, backend: "webgpu", precision: "fp32" },
    capabilities({ webgpu: true, webgpuFp16: false }),
    manifest.variants
  );
  expect(plan.candidates.filter(({ status }) => status === "selected")).toEqual([
    expect.objectContaining({ provider: "webgpu", precision: "fp32", variantId: "fp32" })
  ]);
});
```

Retain the automatic priority assertion: WebGPU FP16, WebGPU FP32, accepted WASM INT8 if present, WASM FP32.

- [ ] **Step 2: Run SDK tests and verify the RED state**

```powershell
pnpm --filter web-sdk-pp-doclayoutv3 exec vitest run tests/detector.test.ts tests/manifest.test.ts tests/runtime-selector.test.ts
```

Expected: FAIL because `DEFAULT_MANIFEST_URL` still targets Pages model `1.0.0`.

- [ ] **Step 3: Change only the default manifest URL**

In `packages/sdk/src/detector.ts`:

```ts
export const DEFAULT_MANIFEST_URL =
  "https://chenmohan123.github.io/web-sdk-PP-DocLayoutV3/models/v1.0.1/manifest.json";
```

No new selection algorithm is needed: the generic selector already has the approved candidate order and reads backend compatibility from the manifest.

- [ ] **Step 4: Run SDK tests and commit**

```powershell
pnpm --filter web-sdk-pp-doclayoutv3 exec vitest run tests/detector.test.ts tests/manifest.test.ts tests/runtime-selector.test.ts
git add -- packages/sdk/src/detector.ts packages/sdk/tests/detector.test.ts packages/sdk/tests/manifest.test.ts packages/sdk/tests/runtime-selector.test.ts
git commit -m "feat(sdk): adopt model manifest 1.0.1"
```

Expected: focused tests pass, including strict explicit WebGPU FP32 and automatic FP16 priority.

### Task 9: Enable GPU FP32 in the Demo without weakening manual strictness

**Files:**
- Modify: `apps/demo/src/execution-preferences.ts`
- Modify: `apps/demo/src/i18n/en.ts`
- Modify: `apps/demo/src/i18n/zh-CN.ts`
- Modify: `apps/demo/tests/demo.spec.ts`

- [ ] **Step 1: Change Demo tests first**

In `apps/demo/tests/demo.spec.ts`, update the pure matrix expectation:

```ts
expect(behavior).toMatchObject({
  autoFallback: true,
  backendFallback: false,
  precisionFallback: false,
  gpuFp16: true,
  gpuFp32: true,
  wasmFp16: false,
  wasmFp32: true,
  gpuCorrection: "fp32",
  wasmCorrection: "fp32"
});
```

Replace the UI test that expected GPU FP32 to be disabled with:

```ts
await precision.getByRole("button", { name: "FP32" }).click();
await backend.getByRole("button", { name: "GPU" }).click();
await expect(precision.getByRole("button", { name: "FP32" })).toBeEnabled();
await expect(precision.getByRole("button", { name: "FP32" })).toHaveAttribute(
  "aria-pressed",
  "true"
);
await expect(page.getByTestId("notice")).not.toContainText("已为你切换模型精度");
```

Keep CPU + FP16 disabled/corrected and keep `allowFallbackForSelection` true only for auto + auto.

- [ ] **Step 2: Run Demo tests and verify the RED state**

```powershell
pnpm --filter demo exec playwright test tests/demo.spec.ts --grep "manual choices strict|validated default model matrix"
```

Expected: FAIL because `DEFAULT_SUPPORT.webgpu` contains only `fp16`.

- [ ] **Step 3: Enable the validated pair and update obsolete messages**

In `apps/demo/src/execution-preferences.ts`:

```ts
const DEFAULT_SUPPORT = {
  webgpu: ["fp16", "fp32"],
  wasm: ["fp32"]
} as const;
```

Remove the obsolete default-GPU-FP32-unvalidated notice from both locale files if no remaining call site uses it. Do not change `allowFallbackForSelection`: manual GPU + FP32 must still set `allowFallback: false`.

- [ ] **Step 4: Run focused and full Demo tests**

```powershell
pnpm --filter demo exec playwright test tests/demo.spec.ts --grep "manual choices strict|validated default model matrix"
pnpm --filter demo test
```

Expected: all tests pass; CPU still resolves to WASM FP32; manual GPU FP32 remains selected and never silently falls back.

- [ ] **Step 5: Commit the Demo matrix**

```powershell
git add -- apps/demo/src/execution-preferences.ts apps/demo/src/i18n/en.ts apps/demo/src/i18n/zh-CN.ts apps/demo/tests/demo.spec.ts
git commit -m "feat(demo): enable validated WebGPU FP32"
```

### Task 10: Stage model `1.0.1` for Pages and update release contracts

**Files:**
- Modify: `scripts/stage-pages-models.mjs`
- Modify: `scripts/verify-release.mjs`
- Modify: `scripts/verify-release.test.mjs`
- Modify: `scripts/benchmark-contract.test.mjs`

- [ ] **Step 1: Write failing Pages staging tests**

Change the expected roots in `scripts/verify-release.test.mjs`:

```js
assert.equal(staged.model.version, "1.0.1");
assert.equal(staged.variants[0].url, "https://pages.test/models/v1.0.1/model-fp16.onnx");
assert.equal(staged.variants[1].url, "https://pages.test/models/v1.0.1/model-fp32.onnx");
```

Add a static contract assertion:

```js
assert.match(
  readFileSync(resolve(repositoryRoot, "scripts/stage-pages-models.mjs"), "utf8"),
  /releases\/download\/v1\.0\.1-models/
);
```

- [ ] **Step 2: Run release tests and verify the RED state**

```powershell
pnpm release:test
```

Expected: FAIL because Pages staging still downloads `v1.0.0-models` into `models/v1.0.0`.

- [ ] **Step 3: Switch Pages staging constants**

In `scripts/stage-pages-models.mjs`:

```js
export const MODEL_RELEASE_ROOT =
  "https://github.com/chenmohan123/web-sdk-PP-DocLayoutV3/releases/download/v1.0.1-models";
export const MODEL_PUBLIC_ROOT =
  "https://chenmohan123.github.io/web-sdk-PP-DocLayoutV3/models/v1.0.1";
```

Change the executable output directory to:

```js
outputRoot: resolve(repositoryRoot, "apps/demo/dist/models/v1.0.1")
```

Keep manifest integrity verification before every write.

- [ ] **Step 4: Change the static SDK release contract to model `1.0.1`**

Update `scripts/verify-release.mjs` static verification to load model `1.0.1`, require FP32 `wasm,webgpu`, and require the Pages staging URL `v1.0.1-models`. Retain `node scripts/verify-release.mjs --models 1.0.0` as an explicit historical verification path.

- [ ] **Step 5: Run staging and release tests**

```powershell
pnpm release:test
pnpm --filter web-sdk-pp-doclayoutv3 build
pnpm --filter demo exec vite build --base /web-sdk-PP-DocLayoutV3/
node scripts/stage-pages-models.mjs
node scripts/verify-release.mjs --static
```

Expected: tests pass; `apps/demo/dist/models/v1.0.1/manifest.json` references Pages URLs and both staged models match release byte size/SHA-256.

- [ ] **Step 6: Commit Pages adoption**

```powershell
git add -- scripts/stage-pages-models.mjs scripts/verify-release.mjs scripts/verify-release.test.mjs scripts/benchmark-contract.test.mjs
git commit -m "build(pages): stage model assets 1.0.1"
```

Do not commit `apps/demo/dist` unless the repository's existing release process explicitly tracks the regenerated build output.

### Task 11: Synchronize bilingual SDK and model documentation

**Files:**
- Modify: `README.md`
- Modify: `README.en.md`
- Modify: `packages/sdk/README.md`
- Modify: `models/README.md`
- Modify: `docs/en/api.md`
- Modify: `docs/en/compatibility.md`
- Modify: `docs/en/models.md`
- Modify: `docs/en/performance.md`
- Modify: `docs/zh-CN/api.md`
- Modify: `docs/zh-CN/compatibility.md`
- Modify: `docs/zh-CN/models.md`
- Modify: `docs/zh-CN/performance.md`
- Modify: `scripts/check-doc-parity.test.mjs`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Write failing documentation matrix assertions**

In `scripts/check-doc-parity.test.mjs`, require all public docs to agree on:

```js
for (const document of [rootReadme, englishReadme, packageReadme, englishModels, chineseModels]) {
  assert.match(document, /1\.0\.1/);
  assert.match(document, /WebGPU.*FP16.*FP32|FP16.*FP32.*WebGPU/is);
  assert.match(document, /WASM.*FP32|FP32.*WASM/is);
  assert.match(document, /FP64.*not supported|不支持.*FP64/is);
}
assert.match(packageReadme, /explicit.*strict|手动.*严格/is);
assert.match(packageReadme, /FP32.*larger.*memory|FP32.*更大.*显存/is);
```

- [ ] **Step 2: Run docs tests and verify the RED state**

```powershell
pnpm docs:test
```

Expected: FAIL because consumer docs still describe WebGPU FP32 as unvalidated or model `1.0.0` as the default.

- [ ] **Step 3: Apply the approved support matrix everywhere**

Use these exact facts in both languages:

- default model version is `1.0.1`, released at `v1.0.1-models`;
- FP16 supports WebGPU and remains the recommended automatic default when `shader-f16` exists;
- sanitized FP32 supports WebGPU and WASM;
- a WebGPU adapter without `shader-f16` can automatically select WebGPU FP32;
- automatic runtime order is WebGPU FP16, WebGPU FP32, validated WASM INT8 if present, WASM FP32;
- explicit selections are strict and expose any session error without silently changing backend/precision;
- FP64 inference is not supported and the original model is float32;
- FP32 is approximately twice the download size of FP16 and may be slower or consume more GPU memory;
- model `1.0.0` and SDK `1.0.4` remain immutable historical releases.

In `CHANGELOG.md`, add an SDK `1.0.5` section:

```markdown
## 1.0.5

- Adopted immutable PP-DocLayoutV3 model `1.0.1`, enabling validated strict WebGPU FP32 execution while retaining WebGPU FP16 as the preferred automatic path.
- Versioned model validation evidence and Pages staging so historical `1.0.0` assets remain unchanged.
```

- [ ] **Step 4: Run docs parity and commit**

```powershell
pnpm docs:test
git add -- README.md README.en.md packages/sdk/README.md models/README.md docs/en/api.md docs/en/compatibility.md docs/en/models.md docs/en/performance.md docs/zh-CN/api.md docs/zh-CN/compatibility.md docs/zh-CN/models.md docs/zh-CN/performance.md scripts/check-doc-parity.test.mjs CHANGELOG.md
git commit -m "docs: document WebGPU FP32 support"
```

### Task 12: Prepare SDK package version `1.0.5`

**Files:**
- Modify: `packages/sdk/package.json`
- Modify: `packages/sdk/src/model/manifest.ts`
- Modify: `packages/sdk/tests/manifest.test.ts`
- Modify: `scripts/verify-release.test.mjs`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Write failing version-alignment tests**

Change assertions to `1.0.5`:

```ts
expect(CURRENT_SDK_VERSION).toBe("1.0.5");
```

```js
assert.equal(packageMetadata.version, "1.0.5");
assert.match(runtime, /CURRENT_SDK_VERSION = "1\.0\.5"/);
assert.match(changelog, /^## 1\.0\.5$/m);
```

- [ ] **Step 2: Run focused tests and verify the RED state**

```powershell
pnpm --filter web-sdk-pp-doclayoutv3 exec vitest run tests/manifest.test.ts
pnpm release:test
```

Expected: FAIL because package/runtime versions remain `1.0.4`.

- [ ] **Step 3: Align package, runtime, and lockfile versions**

Set:

```ts
export const CURRENT_SDK_VERSION = "1.0.5";
```

Set `packages/sdk/package.json` version to `1.0.5`, then refresh only workspace metadata:

```powershell
pnpm install --lockfile-only
```

- [ ] **Step 4: Run focused tests and package build**

```powershell
pnpm --filter web-sdk-pp-doclayoutv3 exec vitest run tests/manifest.test.ts
pnpm release:test
pnpm --filter web-sdk-pp-doclayoutv3 build
```

Expected: all commands pass; generated API declarations contain no unintended public API changes.

- [ ] **Step 5: Commit SDK release preparation**

```powershell
git add -- packages/sdk/package.json packages/sdk/src/model/manifest.ts packages/sdk/tests/manifest.test.ts scripts/verify-release.test.mjs pnpm-lock.yaml CHANGELOG.md
git commit -m "chore(release): prepare v1.0.5"
```

### Task 13: Complete adoption verification and visual QA

**Files:**
- Verify all Phase 2 files

- [ ] **Step 1: Run static and model quality gates**

```powershell
pnpm exec prettier --check .github apps/demo/src apps/demo/tests packages/sdk/src packages/sdk/tests models docs scripts tests CHANGELOG.md README.md README.en.md
pnpm lint
pnpm typecheck
.\.venv-model\Scripts\python.exe -m pytest tools/model-pipeline -q
git diff --check
```

Expected: zero formatting, lint, type, model-pipeline, and whitespace failures.

- [ ] **Step 2: Run workspace, browser, build, and release verification**

```powershell
pnpm docs:test
pnpm benchmark:test
pnpm release:test
pnpm test
pnpm build
pnpm exec playwright test tests/browser/package.spec.ts
node scripts/verify-release.mjs --models 1.0.0
node scripts/verify-release.mjs --models 1.0.1
node scripts/verify-release.mjs --release v1.0.5
```

Expected: all suites pass; release verification sees SDK `1.0.5` and model `1.0.1`; historical model verification remains green.

- [ ] **Step 3: Verify the production Demo against public assets**

Start the built Demo on an unused port and use a physical WebGPU browser at 1440x900 and 390x844. Verify:

- GPU + FP32 is enabled;
- GPU + FP32 completes with actual runtime `webgpu + fp32`;
- the fallback list is empty for the strict manual run;
- auto mode still selects `webgpu + fp16` on an adapter with `shader-f16`;
- CPU mode remains `wasm + fp32`;
- progress distinguishes model download from model loading;
- result, model, timing, fallback, and action sections do not overlap or overflow.

Capture screenshots and the exported JSON. Confirm the exported runtime, model version/hash, and fallback list match the UI.

- [ ] **Step 4: Inspect package and final diff**

```powershell
pnpm --filter web-sdk-pp-doclayoutv3 pack --pack-destination test-results/package
git status --short --branch
git diff origin/develop...HEAD --stat
git diff origin/develop...HEAD --check
```

Expected: the package contains built SDK files only; the diff contains the approved model pipeline, evidence, SDK, Demo, workflow, and documentation changes; generated local test output is not staged.

### Checkpoint B: Explicit confirmation before merging SDK adoption

- [ ] **Wait for the user to explicitly confirm the Phase 2 merge**

Present the passing verification summary, production Demo WebGPU FP32 result, public model URL checks, package contents, and adoption PR diff. Merge the adoption PR only after the user explicitly confirms.

### Checkpoint C: Explicit confirmation before tagging and publishing SDK `v1.0.5`

- [ ] **Wait for the user to explicitly confirm SDK publication**

After the adoption PR is merged to `main`, show the exact main commit and the dry-run result:

```powershell
node scripts/verify-release.mjs --release v1.0.5
pnpm --filter web-sdk-pp-doclayoutv3 publish --dry-run
```

Only after a separate explicit confirmation, create and push tag `v1.0.5`. The existing release workflow must publish `web-sdk-pp-doclayoutv3@1.0.5` through npm Trusted Publishing with provenance.

- [ ] **Verify the published SDK and Demo**

After the release workflow succeeds:

```powershell
npm view web-sdk-pp-doclayoutv3@1.0.5 version dist.integrity dist.tarball --json
gh release view v1.0.5 --json tagName,url,assets
```

Open the production Demo, clear model cache, and repeat strict GPU + FP32 once. Confirm it fetches `models/v1.0.1/manifest.json`, reports `webgpu + fp32`, records no fallback, and uses the sanitized FP32 SHA-256.
