# 模型与精度

[English](../en/models.md)

默认清单固定在 `pp-doclayoutv3/1.0.1`，架构为 `PPDocLayoutV3ForObjectDetection`，参数量 33,175,165，输入为 FP32 `[1, 3, 800, 800]`。模型输出类别、检测框、阅读顺序矩阵和分割 mask。

| 变体 |             大小 | 后端         | 状态                                                      |
| ---- | ---------------: | ------------ | --------------------------------------------------------- |
| FP16 |  74,279,796 字节 | WebGPU       | 7 张验收图 155/155 检测匹配；单次样本物理 WebGPU 验证通过 |
| FP32 | 142,574,928 字节 | WASM、WebGPU | 7 张验收图通过官方对齐、浏览器 WASM 和物理 WebGPU 验证    |
| INT8 |           不发布 | 无           | 精度验收失败，不在默认清单中                              |

FP16 的图输入输出仍保持 FP32，并为 Resize 等敏感算子保留 FP32。全自动模式在 WebGPU `shader-f16` 可用时优先 FP16，没有该能力时可使用 WebGPU FP32，并可在运行时失败后回退到 WASM FP32。手动指定 backend 或 precision 时严格执行，不会静默改写组合。上游模型是 float32，不支持 FP64 推理；FP32 约为 FP16 两倍大小，可能更慢并占用更多 GPU 内存。历史 `1.0.0` 模型资产保持不变。

上游模型为 PaddlePaddle `PP-DocLayoutV3_safetensors`，官方元数据声明 Apache-2.0。本项目的转换产物也按 Apache-2.0 分发；使用者仍应保留 [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md) 中的归属与引用。
