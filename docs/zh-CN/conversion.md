# 模型转换

[English](../en/conversion.md)

转换工具位于 `tools/model-pipeline`，要求 Python 3.11。它从 safetensors 导出 opset 18 FP32 ONNX，执行结构/数值/检测结果对齐，再生成 FP16 候选、验证变体并构建清单。不要手工修改 `manifest.json`。

```powershell
Set-Location tools/model-pipeline
python -m ppdoclayout.inspect_model
python -m ppdoclayout.export_fp32
python -m ppdoclayout.validate
python -m ppdoclayout.convert_fp16
python -m ppdoclayout.variant_validation
python -m ppdoclayout.build_manifest
```

具体参数与本地模型路径以各模块的 `--help` 为准。验证报告必须绑定源文件 SHA-256、ONNX SHA-256、opset、输入输出名称/形状、检测匹配和浏览器运行证据。只有通过验收的变体才能写入清单。

## WebGPU FP32 来源与复现

上游 `torch_dtype` 是 float32，不是 FP64 推理；FP64 推理不支持。sanitizer 只把位置编码路径中的四个 DOUBLE initializer `sin`、`cos`、`sin_1`、`cos_1` 转为 FLOAT，每个形状都是 `[625, 64]`，并保留原有 FLOAT Cast。学习参数以及图输入输出契约不变。源 FP32 SHA-256 为 `fc2eebdc2153ad4e6993766f914f78f47a737fed123a78731bc9c57f7a6c806b`，sanitized 产物 SHA-256 为 `476da6d3892bc6211ec90f53df1f68722626b3cf67af77d1c75bd0bd2ee8d269`。

当前根目录模型保留经过 WebGPU 验证的 FP32 产物。`1.0.1` 等版本值只作为报告中的来源标签，不再用于模型目录命名。FP32 在 7 张授权图片上通过 CPU parity、严格浏览器 WASM 和物理 WebGPU，且没有 fallback。FP16 与此前验收的产物字节完全一致，并通过 CPU 精度验收及真实浏览器 WASM、WebGPU 运行。

将外部导出的原始 FP32 文件清理后写入当前根目录模型：

```powershell
.\.venv-model\Scripts\python.exe tools/model-pipeline/ppdoclayout/sanitize_fp32.py `
  --source <原始-model-fp32.onnx-路径> `
  --output models/pp-doclayoutv3/model-fp32.onnx
```

随后使用 `tools/model-pipeline/reports/` 下的 FP32 parity、浏览器证据和变体验证报告；manifest 生成器会将清单写入 `models/pp-doclayoutv3/manifest.json`，并拒绝任何哈希、样本、provider、精度或 fallback 不一致。
