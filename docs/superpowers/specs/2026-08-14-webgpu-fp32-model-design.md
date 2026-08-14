# WebGPU FP32 Model Design

## Problem

The published FP32 ONNX model works through WASM but cannot create an ONNX Runtime Web WebGPU session. A strict physical-browser run with the current model fails before inference with:

```text
ONNX session-create failed for webgpu: Can't create a session.
transformer_memcpy.cc:254 ... Provider type for Cast node with name
'node__to_copy_4' is not set.
```

The model is not an FP64 model. Its weights, graph inputs, graph outputs, and intended execution precision are FP32. The exported graph contains four precomputed positional-encoding initializers named `sin`, `cos`, `sin_1`, and `cos_1`. Each initializer is DOUBLE with shape `[625, 64]`. `node_cat_7` concatenates them into a DOUBLE `[625, 256]` tensor, and `node__to_copy_4` immediately casts that tensor to FLOAT.

ONNX Runtime Web 1.27.0 has no WebGPU DOUBLE tensor mapping. The DOUBLE-to-FLOAT Cast therefore receives no execution provider and triggers the internal assertion. WASM can execute the DOUBLE path. The FP16 conversion already rewrites the path to FP16/FLOAT and therefore creates a WebGPU session successfully.

## Goals

- Produce an immutable PP-DocLayoutV3 model version `1.0.1` whose FP32 graph contains no DOUBLE data path.
- Preserve the accepted FP32 numerical and detection behavior on all seven licensed fixtures.
- Validate the new FP32 artifact through both browser WASM and physical WebGPU without runtime fallback.
- Keep WebGPU FP16 as the automatic default when `shader-f16` is available.
- Allow explicit WebGPU FP32 selection after validation succeeds.
- Release the model assets independently before SDK `1.0.5` adopts the new default manifest.

## Non-Goals

- Do not overwrite or delete any `v1.0.0-models` asset.
- Do not change the existing `1.0.0` manifest or the behavior of SDK `1.0.4`.
- Do not claim FP64 inference support.
- Do not retrain or change learned model weights.
- Do not weaken existing numerical, detection, integrity, or browser acceptance thresholds.

## Versioned Assets

Create `models/pp-doclayoutv3/1.0.1/` with:

- `model-fp32.onnx`: a deterministically sanitized FP32 graph;
- `model-fp16.onnx`: byte-identical to the accepted `1.0.0` FP16 artifact;
- `manifest.json`: a generated schema-version-1 manifest for model version `1.0.1`.

Publish the files through an immutable `v1.0.1-models` GitHub Release. The new manifest uses release URLs under that tag and retains `minSdkVersion: "1.0.0"` because its schema and runtime contract remain compatible with existing SDK parsing. SDK `1.0.5` is the first release that selects this manifest by default.

The manifest contains two variants:

| Variant | Precision | Backends | Priority |
| --- | --- | --- | --- |
| `fp16` | FP16 | WebGPU | 1 |
| `fp32` | FP32 | WebGPU, WASM | 2 |

`variantPriority` remains `["fp16", "fp32"]`.

## Deterministic FP32 Sanitization

Add a focused model-pipeline transform that reads the accepted `1.0.0/model-fp32.onnx` and writes the `1.0.1` FP32 artifact. The transform must:

1. Run ONNX validation before changing the graph.
2. Require exactly four DOUBLE initializers named `sin`, `cos`, `sin_1`, and `cos_1`, each with shape `[625, 64]`.
3. Require those values to feed `node_cat_7`, followed by the known `node__to_copy_4` Cast to FLOAT.
4. Convert the four initializer payloads to FLOAT without changing their names or shapes.
5. Preserve the Cast unless ONNX optimization removes it deterministically; FLOAT-to-FLOAT is semantically redundant.
6. Reject any additional DOUBLE initializer, graph input, graph output, or inferred intermediate value.
7. Run ONNX checker and shape inference on the result.
8. Write the output atomically and report its byte size and SHA-256.

Converting the constants early preserves the intended value: the existing graph already rounds each DOUBLE value to FLOAT immediately after concatenation. The transform remains guarded by numerical and browser validation rather than relying on this reasoning alone.

## Validation Gates

### Structural Gate

- ONNX checker passes at opset 18.
- Input remains `pixel_values`, FLOAT `[1, 3, 800, 800]`.
- The four public outputs retain their current names, FLOAT types, and shapes.
- No DOUBLE initializer or inferred DOUBLE tensor remains.
- Learned parameter tensors are unchanged.

### CPU and Detection Gate

Run the existing seven-fixture FP32 validation against both the accepted `1.0.0` FP32 model and the sanitized `1.0.1` FP32 model.

- Detection counts, label sequences, and reading order must match.
- No current coordinate, polygon, or score threshold may be relaxed.
- Raw outputs should be bit-identical. If execution-graph optimization prevents bit identity, the existing FP32 raw-output and detection thresholds remain the maximum accepted difference.
- The validation report records both source and candidate SHA-256 values.

### Browser WASM Gate

- Create a strict WASM FP32 session from the new artifact.
- Run all seven fixtures without fallback.
- Match the accepted FP32 detection behavior.
- Record browser, ORT version, model hash, session-creation time, inference time, and output evidence.

### Physical WebGPU Gate

- Create a strict WebGPU FP32 session with fallback disabled.
- Run all seven fixtures on a physical adapter.
- Match the accepted FP32 detection behavior.
- Record browser version, operating system, adapter identity and features, ORT version, model hash, session-creation time, per-fixture inference timing, output hashes, and detection comparisons.

Any failed gate prevents the manifest from advertising WebGPU FP32 and prevents SDK adoption.

## SDK Selection Behavior

SDK `1.0.5` changes `DEFAULT_MANIFEST_URL` to the versioned `1.0.1` manifest. The generic selector already orders automatic candidates as:

1. WebGPU FP16;
2. WebGPU FP32;
3. WASM INT8 when a validated variant exists;
4. WASM FP32.

With the new manifest:

- devices with `shader-f16` continue to select WebGPU FP16 automatically;
- WebGPU devices without `shader-f16` may select WebGPU FP32;
- explicit WebGPU FP32 requests are valid and remain strict by default;
- automatic mode may fall back to WASM FP32 after a WebGPU runtime failure;
- manual Demo selections never silently change precision or backend.

## Demo and Documentation

The Demo continues to derive enabled combinations from the active manifest. After SDK `1.0.5` adopts model `1.0.1`, GPU mode enables FP32. FP16 remains the recommended default because it has a smaller download and normally uses less memory.

Update the root READMEs, packaged SDK README, compatibility, API, conversion, model, and benchmark documentation in both languages. Documentation must state that:

- the new FP32 artifact is validated for WebGPU and WASM;
- FP64 inference is not supported;
- explicit selections are strict;
- FP32 is larger and may be slower or use more GPU memory than FP16;
- historical `1.0.0` model assets remain immutable.

## Pipeline and Release Boundaries

Parameterize model-version and release-tag constants that are currently fixed to `1.0.0`. Update manifest generation, model validation, Pages staging, release verification, and model-asset workflow tests to bind every URL, hash, report, and local path to `1.0.1`.

Use two integration phases:

1. **Model asset phase**: add the transform, tests, `1.0.1` artifacts, reports, generated manifest, documentation evidence, and the `v1.0.1-models` upload workflow. Merge and publish the immutable model Release after all model gates pass.
2. **SDK adoption phase**: after the new asset URLs are publicly fetchable, switch the SDK default manifest, enable the Demo matrix, update consumer documentation and release contracts, then prepare SDK `1.0.5`.

This ordering prevents CI or published SDKs from referring to model URLs that do not yet exist.

## Error Handling

- The sanitizer fails closed on unexpected names, shapes, topology, or DOUBLE values.
- Manifest generation fails if model hashes or browser evidence do not match the artifacts.
- Release verification fetches staged assets and checks byte size and SHA-256.
- Explicit WebGPU FP32 session failures remain visible with the detailed ONNX Runtime cause and never fall back silently.
- Automatic fallback history records provider, precision, failure stage, code, and cause.

## Acceptance Criteria

- Historical `v1.0.0-models` assets and SDK `1.0.4` remain unchanged.
- The sanitizer has red-green regression coverage and produces a checked graph with no DOUBLE values.
- The new FP32 artifact passes current FP32 parity and detection gates on seven fixtures.
- The new FP32 artifact passes strict browser WASM and strict physical WebGPU execution.
- The `1.0.1` manifest is generated from verified reports and advertises FP32 for both WebGPU and WASM.
- SDK selector and Demo tests cover automatic and explicit WebGPU FP32 behavior without weakening strict manual semantics.
- Bilingual documentation and release contracts agree with the validated matrix.
- Full workspace verification, package smoke tests, Pages staging, and production builds pass before SDK release preparation.
