# 模型文件 / Model files

## 中文

本目录保存当前 PP-DocLayoutV3 的 ONNX 产物和由构建脚本生成的清单。`manifest.json` 与 FP16、FP32 文件始终位于 `models/pp-doclayoutv3/` 根目录；模型更新时直接整体替换这三个文件。`model.version`、来源 revision、文件大小和 SHA-256 仍写入清单，用于完整性校验和来源追溯。历史版本只保留在 benchmark/report 和远程 revision 证据中，不作为 Demo 下载路径。

### 当前清单（model.version = 1.0.2）

| 文件              | 精度                    | 兼容后端     |    字节数 | SHA-256                                                            | 状态                                           |
| ----------------- | ----------------------- | ------------ | --------: | ------------------------------------------------------------------ | ---------------------------------------------- |
| `model-fp16.onnx` | FP16（图边界保持 FP32） | WASM、WebGPU |  74279796 | `463ba56faa555baf84271b4002b33b0c5fcc50776fe4f39344235eccb72073f2` | CPU 精度验收及真实浏览器 WASM、WebGPU 验证通过 |
| `model-fp32.onnx` | FP32                    | WASM、WebGPU | 142574928 | `476da6d3892bc6211ec90f53df1f68722626b3cf67af77d1c75bd0bd2ee8d269` | 7 张授权图片、严格 WASM 和物理 WebGPU 均通过   |

INT8 候选没有通过精度验收，浏览器 WASM 验证因此未执行；它不发布，也不会写入当前清单。当前清单声明 FP16、FP32 均兼容 WebGPU 和 WASM/CPU。

当前 Demo/Pages 模型地址前缀：

`https://chenmohan123.github.io/web-sdk-PP-DocLayoutV3/models/`

模型文件由 Git LFS 管理，Demo 与清单同步更新，不通过历史 commit 下载旧模型。文件下载后应先按清单中的字节数和 SHA-256 校验，再创建 ONNX Runtime session。GitHub Release 和历史 revision 仅用于发布审计与来源证据。

### WebGPU FP32 来源证据

当前 FP32 文件沿用经过 WebGPU 验证的来源产物。`1.0.1`、`1.0.2` 等版本号只用于清单元数据和验证报告，模型文件不再按版本建立目录。

上游 `torch_dtype` 是 float32，这不是 FP64 推理；FP64 inference 不支持。为使 FP32 图在 WebGPU 上可执行，只转换位置编码路径中的 `sin`、`cos`、`sin_1`、`cos_1` 四个 DOUBLE initializer，每个形状都是 `[625, 64]`，在原有 FLOAT Cast 之前转换为 FLOAT。学习参数、图输入输出名称/形状和 opset 18 保持不变。源 FP32 SHA-256 为 `fc2eebdc2153ad4e6993766f914f78f47a737fed123a78731bc9c57f7a6c806b`，sanitized FP32 SHA-256 为 `476da6d3892bc6211ec90f53df1f68722626b3cf67af77d1c75bd0bd2ee8d269`。

| 文件              | 精度 | 兼容后端     |    字节数 | SHA-256                                                            | 验证                                         |
| ----------------- | ---- | ------------ | --------: | ------------------------------------------------------------------ | -------------------------------------------- |
| `model-fp16.onnx` | FP16 | WebGPU       |  74279796 | `463ba56faa555baf84271b4002b33b0c5fcc50776fe4f39344235eccb72073f2` | 与已验收的 1.0.0 FP16 字节完全一致           |
| `model-fp32.onnx` | FP32 | WASM、WebGPU | 142574928 | `476da6d3892bc6211ec90f53df1f68722626b3cf67af77d1c75bd0bd2ee8d269` | 7 张授权图片、严格 WASM 和物理 WebGPU 均通过 |

复现 sanitizer（仓库根目录）：

```powershell
.\.venv-model\Scripts\python.exe tools/model-pipeline/ppdoclayout/sanitize_fp32.py `
  --source models/pp-doclayoutv3/model-fp32.onnx `
  --output models/pp-doclayoutv3/model-fp32.onnx
```

生成器会拒绝额外 DOUBLE、错误形状或错误拓扑；只有通过七样本 CPU parity、严格浏览器 WASM 和物理 WebGPU 证据的当前文件才能写入根目录 `manifest.json`。

### 重现清单

清单由模型契约、FP32 验证报告、变体验证报告和实际 ONNX 文件生成，不能手工编辑。在仓库根目录执行：

```powershell
Set-Location tools/model-pipeline
..\..\.venv-model\Scripts\python.exe -m ppdoclayout.build_manifest
```

生成器默认读取根目录模型与当前验证报告，并输出根目录 `manifest.json`。它会检查输入输出名称与形状、opset、文件大小、SHA-256 及验证状态；任何不一致都会终止生成。SDK 支持用户提供自定义微调模型清单，但自定义模型必须声明并满足同一运行时契约，不能假定与本清单兼容。

### 来源与许可

转换输入来自 PaddlePaddle 的 [PP-DocLayoutV3 safetensors](https://huggingface.co/PaddlePaddle/PP-DocLayoutV3_safetensors)。上游模型也见 [ModelScope](https://modelscope.cn/models/PaddlePaddle/PP-DocLayoutV3)，项目实现与资料见 [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR)。根据官方模型元数据，模型以 Apache-2.0 许可提供。完整归属与论文引用见仓库根目录的 `THIRD_PARTY_NOTICES.md`。

## English

This directory contains the current PP-DocLayoutV3 ONNX artifacts and generated manifest. `manifest.json`, `model-fp16.onnx`, and `model-fp32.onnx` share the `models/pp-doclayoutv3/` root and are replaced together when the model is updated. Version values, source revisions, hashes, and validation reports remain metadata/evidence; historical assets are not Demo download paths. The rejected INT8 candidate remains undistributed.

The ONNX files are managed by Git LFS. The Demo and Pages deployment read the root URL `https://chenmohan123.github.io/web-sdk-PP-DocLayoutV3/models/`; GitHub Releases and historical revisions are retained only for audit evidence. Regenerate the current manifest with the command above; the generator binds report claims to the actual ONNX size, SHA-256, graph contract, opset, and browser execution providers. Custom fine-tuned manifests require the same explicit runtime contract.

### WebGPU FP32 provenance

The current FP32 artifact keeps the validated WebGPU transformation. Version values such as `1.0.1` are provenance labels, not model directory names. The upstream `torch_dtype` is float32; this is not FP64 inference, and FP64 inference is not supported. The sanitizer converts only `sin`, `cos`, `sin_1`, and `cos_1`, each DOUBLE with shape `[625, 64]`, to FLOAT before the existing FLOAT Cast. Learned initializers and the graph input/output contract remain unchanged. The source FP32 SHA-256 is `fc2eebdc2153ad4e6993766f914f78f47a737fed123a78731bc9c57f7a6c806b`; the sanitized artifact SHA-256 is `476da6d3892bc6211ec90f53df1f68722626b3cf67af77d1c75bd0bd2ee8d269`.

The FP16 artifact is byte-identical to the previously accepted artifact. The current FP32 artifact passed seven licensed fixtures in strict browser WASM and on a physical WebGPU adapter. Reproduce the sanitizer with the command shown above; the generated root manifest is gated by the CPU parity and browser reports.

The upstream PaddlePaddle model is identified as Apache-2.0 by its official metadata. See `THIRD_PARTY_NOTICES.md` for attribution and citation details.
