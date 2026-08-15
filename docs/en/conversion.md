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

FP32 acceptance covers seven licensed fixtures: at threshold 0.5, detection counts, label sequences, and reading order all match; browser WASM execution also passed. FP16 passed the same CPU fixture acceptance plus real browser WASM and WebGPU execution. No physical WebGPU FP32 validation has been recorded, so the default manifest limits FP32 to WASM. The INT8 candidate failed detection matching and is not distributed.
