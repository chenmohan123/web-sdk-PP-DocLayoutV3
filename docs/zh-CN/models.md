# 模型与精度

[English](../en/models.md)

默认清单固定在 `pp-doclayoutv3/1.0.0`，架构为 `PPDocLayoutV3ForObjectDetection`，参数量 33,175,165，输入为 FP32 `[1, 3, 800, 800]`。模型输出类别、检测框、阅读顺序矩阵和分割 mask。

| 变体 |             大小 | 后端   | 状态                                                  |
| ---- | ---------------: | ------ | ----------------------------------------------------- |
| FP16 |  74,279,796 字节 | WebGPU | 7 张验收图 155/155 检测匹配；真实 WebGPU 验证通过     |
| FP32 | 143,216,104 字节 | WASM   | 官方实现对齐和浏览器 WASM 验证通过；未记录物理 WebGPU |
| INT8 |           不发布 | 无     | 精度验收失败，不在默认清单中                          |

FP16 的图输入输出仍保持 FP32，并为 Resize 等敏感算子保留 FP32。全自动模式在 WebGPU `shader-f16` 可用时优先 FP16，并可回退到 WASM FP32。默认清单没有已验证的 WebGPU FP32 或 WASM FP16 组合，显式请求任一组合都会以 `CAPABILITY_UNSUPPORTED` 失败；自定义清单可在单独验证后启用这些组合。

上游模型为 PaddlePaddle `PP-DocLayoutV3_safetensors`，官方元数据声明 Apache-2.0。本项目的转换产物也按 Apache-2.0 分发；使用者仍应保留 [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md) 中的归属与引用。
