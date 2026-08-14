# Model conversion

[中文](../zh-CN/conversion.md)

The conversion tools live in `tools/model-pipeline` and require Python 3.11. They export an opset 18 FP32 ONNX graph from safetensors, run graph/numeric/detection parity, produce an FP16 candidate, validate variants, and build the manifest. Do not hand-edit `manifest.json`.

```powershell
Set-Location tools/model-pipeline
python -m ppdoclayout.inspect_model
python -m ppdoclayout.export_fp32
python -m ppdoclayout.validate
python -m ppdoclayout.convert_fp16
python -m ppdoclayout.variant_validation
python -m ppdoclayout.build_manifest
```

Use each module's `--help` for exact local model paths and arguments. Validation reports bind source and ONNX SHA-256 values, opset, tensor names/shapes, detection matching, and browser runtime evidence. Only accepted variants may enter the manifest.

## Model 1.0.1 WebGPU FP32 provenance

The upstream `torch_dtype` is float32; this is not FP64 inference, and FP64 inference is not supported. The sanitizer converts only the four positional DOUBLE initializers `sin`, `cos`, `sin_1`, and `cos_1`, each with shape `[625, 64]`, to FLOAT before the existing FLOAT Cast. Learned initializers and the graph input/output contract remain unchanged. The source FP32 SHA-256 is `fc2eebdc2153ad4e6993766f914f78f47a737fed123a78731bc9c57f7a6c806b`; the sanitized artifact SHA-256 is `476da6d3892bc6211ec90f53df1f68722626b3cf67af77d1c75bd0bd2ee8d269`.

Model `1.0.1` is prepared for publication under the immutable `v1.0.1-models` release. Its FP32 artifact passed CPU parity on seven licensed fixtures, strict browser WASM, and a physical WebGPU adapter with no fallback. The FP16 artifact is byte-identical to the accepted `1.0.0` FP16 artifact. Historical `v1.0.0-models` assets remain immutable.

Reproduce the sanitized graph from the repository root:

```powershell
.\.venv-model\Scripts\python.exe tools/model-pipeline/ppdoclayout/sanitize_fp32.py `
  --source models/pp-doclayoutv3/1.0.0/model-fp32.onnx `
  --output models/pp-doclayoutv3/1.0.1/model-fp32.onnx
```

Then run the versioned FP32 parity, browser evidence, variant validation, and manifest commands with `tools/model-pipeline/reports/1.0.1/`; the manifest generator rejects any hash, fixture, provider, precision, or fallback mismatch.
