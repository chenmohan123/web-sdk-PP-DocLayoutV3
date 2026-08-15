# 模型文件 / Model files

## 中文

本目录保存 PP-DocLayoutV3 的版本化 ONNX 产物和由构建脚本生成的清单。`pp-doclayoutv3/1.0.0/` 中的 ONNX 文件通过 Git LFS 随仓库提供，并作为不可变 `v1.0.0-models` GitHub Release 资产。默认 `pp-doclayoutv3/1.0.1/manifest.json` 复用这两个字节完全相同的模型文件，只增加经过真实浏览器验证的 FP16 WASM 兼容性。

### 1.0.1 默认清单

| 文件              | 精度                    | 兼容后端     |    字节数 | SHA-256                                                            | 状态                                                              |
| ----------------- | ----------------------- | ------------ | --------: | ------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `model-fp16.onnx` | FP16（图边界保持 FP32） | WASM、WebGPU |  74279796 | `463ba56faa555baf84271b4002b33b0c5fcc50776fe4f39344235eccb72073f2` | CPU 精度验收及真实浏览器 WASM、WebGPU 验证通过，已纳入 1.0.1 清单 |
| `model-fp32.onnx` | FP32                    | WASM         | 143216104 | `fc2eebdc2153ad4e6993766f914f78f47a737fed123a78731bc9c57f7a6c806b` | 官方实现对齐和浏览器 WASM 验证通过，已纳入 1.0.1 清单             |

INT8 候选没有通过精度验收，浏览器 WASM 验证因此未执行；它不发布，也不会写入默认清单。FP16 是 WebGPU 和 WASM/CPU 的已验证变体，FP32 是 WASM/CPU 的已验证变体。FP32 尚未记录物理 WebGPU 验证，因此默认清单不声明 WebGPU FP32 兼容性。已发布的 `1.0.0` 清单保持不变：FP16 仅声明 WebGPU，FP32 仅声明 WASM。

不可变模型文件下载前缀：

`https://github.com/chenmohan123/web-sdk-PP-DocLayoutV3/releases/download/v1.0.0-models/`

`1.0.1` manifest 发布前缀：

`https://github.com/chenmohan123/web-sdk-PP-DocLayoutV3/releases/download/v1.0.1-models/`

默认清单和模型 URL 绝不使用可变的 `latest` 地址。文件下载后应先按清单中的字节数和 SHA-256 校验，再创建 ONNX Runtime session。

### 重现清单

清单由模型契约、FP32 验证报告、变体验证报告和实际 ONNX 文件生成，不能手工编辑。在仓库根目录执行：

```powershell
Set-Location tools/model-pipeline
..\..\.venv-model\Scripts\python.exe -m ppdoclayout.build_manifest
```

生成器会检查输入输出名称与形状、opset、文件大小、SHA-256 及验证状态；任何不一致都会终止生成。SDK 的后续实现将支持用户提供自定义微调模型清单，但自定义模型必须声明并满足同一运行时契约，不能假定与本清单兼容。

### 来源与许可

转换输入来自 PaddlePaddle 的 [PP-DocLayoutV3 safetensors](https://huggingface.co/PaddlePaddle/PP-DocLayoutV3_safetensors)。上游模型也见 [ModelScope](https://modelscope.cn/models/PaddlePaddle/PP-DocLayoutV3)，项目实现与资料见 [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR)。根据官方模型元数据，模型以 Apache-2.0 许可提供。完整归属与论文引用见仓库根目录的 `THIRD_PARTY_NOTICES.md`。

## English

This directory contains versioned PP-DocLayoutV3 ONNX artifacts and generated manifests. The default 1.0.1 manifest reuses the immutable model binaries from `v1.0.0-models`, declares the validated FP16 WebGPU and WASM/CPU variant, and retains the FP32 WASM/CPU fallback. The published 1.0.0 manifest remains unchanged. No physical WebGPU FP32 validation has been recorded, so the default manifest does not advertise that pair. The rejected INT8 candidate is not distributed and is absent from the default manifest.

The ONNX files are available through Git LFS and the immutable `v1.0.0-models` GitHub Release URLs above. The compatibility-only 1.0.1 release carries its new manifest and evidence without duplicating those model binaries. Regenerate the current manifest with the command above; the generator binds report claims to the actual ONNX size, SHA-256, graph contract, opset, and both browser execution providers. Custom fine-tuned manifests require the same explicit runtime contract.

The upstream PaddlePaddle model is identified as Apache-2.0 by its official metadata. See `THIRD_PARTY_NOTICES.md` for attribution and citation details.
