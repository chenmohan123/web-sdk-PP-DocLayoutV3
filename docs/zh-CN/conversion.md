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

FP32 验收覆盖 7 张授权测试图，在阈值 0.5 下检测数量、标签序列和阅读顺序全部一致，并通过浏览器 WASM 运行。FP16 通过同一组 CPU 精度验收及真实浏览器 WASM、WebGPU 运行。FP32 尚未记录物理 WebGPU 验证，因此默认清单仅把 FP32 用于 WASM。INT8 候选未达到检测匹配阈值，因此没有发布。
