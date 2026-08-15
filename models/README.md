# 模型文件 / Model files

## 中文

本目录保存 PP-DocLayoutV3 的版本化 ONNX 产物和由构建脚本生成的清单。默认 SDK 使用 `pp-doclayoutv3/1.0.2/manifest.json`；它复用 `v1.0.1-models` 中不可变的 FP16、FP32 二进制，只增加经过真实浏览器验证的 CPU/WASM FP16 兼容性。`1.0.0` 和 `1.0.1` 清单保持历史不变。

### 1.0.2 默认清单

| 文件              | 精度                    | 兼容后端     |    字节数 | SHA-256                                                            | 状态                                                              |
| ----------------- | ----------------------- | ------------ | --------: | ------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `model-fp16.onnx` | FP16（图边界保持 FP32） | WASM、WebGPU |  74279796 | `463ba56faa555baf84271b4002b33b0c5fcc50776fe4f39344235eccb72073f2` | CPU 精度验收及真实浏览器 WASM、WebGPU 验证通过，已纳入 1.0.2 清单 |
| `model-fp32.onnx` | FP32                    | WASM、WebGPU | 142574928 | `476da6d3892bc6211ec90f53df1f68722626b3cf67af77d1c75bd0bd2ee8d269` | 7 张授权图片、严格 WASM 和物理 WebGPU 均通过，已纳入 1.0.2 清单   |

INT8 候选没有通过精度验收，浏览器 WASM 验证因此未执行；它不发布，也不会写入默认清单。当前 `1.0.2` 清单声明 FP16、FP32 均兼容 WebGPU 和 WASM/CPU；历史 `1.0.1` 清单仍保持 FP16 仅支持 WebGPU、FP32 支持 WASM 和 WebGPU。

不可变模型文件下载前缀：

`https://github.com/chenmohan123/web-sdk-PP-DocLayoutV3/releases/download/v1.0.1-models/`

历史 `1.0.0` 模型文件下载前缀：

`https://github.com/chenmohan123/web-sdk-PP-DocLayoutV3/releases/download/v1.0.0-models/`

`1.0.2` manifest 发布前缀：

`https://github.com/chenmohan123/web-sdk-PP-DocLayoutV3/releases/download/v1.0.2-models/`

默认清单和模型 URL 绝不使用可变的 `latest` 地址。文件下载后应先按清单中的字节数和 SHA-256 校验，再创建 ONNX Runtime session。

### 1.0.1 WebGPU FP32 变体

`1.0.1` 是独立的、不可覆盖的模型资产版本，发布前缀为
`https://github.com/chenmohan123/web-sdk-PP-DocLayoutV3/releases/download/v1.0.1-models/`。
它不会改写 `v1.0.0-models` 或 SDK `1.0.4`；SDK `1.0.5` 默认使用该模型。

上游 `torch_dtype` 是 float32，这不是 FP64 推理；FP64 inference 不支持。为使 FP32 图在 WebGPU 上可执行，只转换位置编码路径中的 `sin`、`cos`、`sin_1`、`cos_1` 四个 DOUBLE initializer，每个形状都是 `[625, 64]`，在原有 FLOAT Cast 之前转换为 FLOAT。学习参数、图输入输出名称/形状和 opset 18 保持不变。源 FP32 SHA-256 为 `fc2eebdc2153ad4e6993766f914f78f47a737fed123a78731bc9c57f7a6c806b`，sanitized FP32 SHA-256 为 `476da6d3892bc6211ec90f53df1f68722626b3cf67af77d1c75bd0bd2ee8d269`。

| 文件              | 精度 | 兼容后端     |    字节数 | SHA-256                                                            | 验证                                         |
| ----------------- | ---- | ------------ | --------: | ------------------------------------------------------------------ | -------------------------------------------- |
| `model-fp16.onnx` | FP16 | WebGPU       |  74279796 | `463ba56faa555baf84271b4002b33b0c5fcc50776fe4f39344235eccb72073f2` | 与已验收的 1.0.0 FP16 字节完全一致           |
| `model-fp32.onnx` | FP32 | WASM、WebGPU | 142574928 | `476da6d3892bc6211ec90f53df1f68722626b3cf67af77d1c75bd0bd2ee8d269` | 7 张授权图片、严格 WASM 和物理 WebGPU 均通过 |

复现 sanitizer（仓库根目录）：

```powershell
.\.venv-model\Scripts\python.exe tools/model-pipeline/ppdoclayout/sanitize_fp32.py `
  --source models/pp-doclayoutv3/1.0.0/model-fp32.onnx `
  --output models/pp-doclayoutv3/1.0.1/model-fp32.onnx
```

生成器会拒绝额外 DOUBLE、错误形状或错误拓扑；只有通过七样本 CPU parity、严格浏览器 WASM 和物理 WebGPU 证据的版本才能进入 `1.0.1/manifest.json`。

### 重现清单

清单由模型契约、FP32 验证报告、变体验证报告和实际 ONNX 文件生成，不能手工编辑。在仓库根目录执行：

```powershell
Set-Location tools/model-pipeline
..\..\.venv-model\Scripts\python.exe -m ppdoclayout.build_manifest
```

生成器默认读取 `1.0.1` 模型二进制与 `1.0.2` 验证报告，并输出 `1.0.2/manifest.json`。它会检查输入输出名称与形状、opset、文件大小、SHA-256 及验证状态；任何不一致都会终止生成。SDK 支持用户提供自定义微调模型清单，但自定义模型必须声明并满足同一运行时契约，不能假定与本清单兼容。

### 来源与许可

转换输入来自 PaddlePaddle 的 [PP-DocLayoutV3 safetensors](https://huggingface.co/PaddlePaddle/PP-DocLayoutV3_safetensors)。上游模型也见 [ModelScope](https://modelscope.cn/models/PaddlePaddle/PP-DocLayoutV3)，项目实现与资料见 [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR)。根据官方模型元数据，模型以 Apache-2.0 许可提供。完整归属与论文引用见仓库根目录的 `THIRD_PARTY_NOTICES.md`。

## English

This directory contains versioned PP-DocLayoutV3 ONNX artifacts and generated manifests. Historical versions 1.0.0 and 1.0.1 remain unchanged. The default 1.0.2 manifest reuses immutable 1.0.1 binaries, retains the sanitized FP32 artifact validated on WASM and physical WebGPU, and adds validated FP16 WASM/CPU compatibility; the rejected INT8 candidate remains undistributed and absent from the default manifest.

The ONNX files are available through Git LFS and immutable GitHub Release URLs. The compatibility-only `v1.0.2-models` release carries its manifest and evidence without duplicating the `v1.0.1-models` binaries. Regenerate the current manifest with the command above; the generator binds report claims to the actual ONNX size, SHA-256, graph contract, opset, and browser execution providers. Custom fine-tuned manifests require the same explicit runtime contract.

### Model 1.0.1 WebGPU FP32 provenance

Model `1.0.1` is published under the immutable `v1.0.1-models` release and does not alter historical `v1.0.0-models` assets or the SDK `1.0.4` default; SDK `1.0.5` adopts it. The upstream `torch_dtype` is float32; this is not FP64 inference, and FP64 inference is not supported. The sanitizer converts only `sin`, `cos`, `sin_1`, and `cos_1`, each DOUBLE with shape `[625, 64]`, to FLOAT before the existing FLOAT Cast. Learned initializers and the graph input/output contract remain unchanged. The source FP32 SHA-256 is `fc2eebdc2153ad4e6993766f914f78f47a737fed123a78731bc9c57f7a6c806b`; the sanitized artifact SHA-256 is `476da6d3892bc6211ec90f53df1f68722626b3cf67af77d1c75bd0bd2ee8d269`.

The FP16 artifact is byte-identical to the accepted `1.0.0` FP16 artifact. The new FP32 artifact passed seven licensed fixtures in strict browser WASM and on a physical WebGPU adapter. Reproduce the sanitizer with the command shown above; the generated manifest is gated by the CPU parity and browser reports.

The upstream PaddlePaddle model is identified as Apache-2.0 by its official metadata. See `THIRD_PARTY_NOTICES.md` for attribution and citation details.
