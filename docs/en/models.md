# Models and precision

[中文](../zh-CN/models.md)

The default manifest is fixed at `pp-doclayoutv3/1.0.1`. Its architecture is `PPDocLayoutV3ForObjectDetection`, it has 33,175,165 parameters, and its FP32 input is `[1, 3, 800, 800]`. Outputs contain class scores, boxes, reading-order logits, and segmentation masks.

| Variant |              Size | Backend      | Status                                                                                                  |
| ------- | ----------------: | ------------ | ------------------------------------------------------------------------------------------------------- |
| FP16    |  74,279,796 bytes | WebGPU       | 155/155 detections matched across seven acceptance images; one sample passed physical WebGPU validation |
| FP32    | 142,574,928 bytes | WASM, WebGPU | seven acceptance images passed official parity, strict browser WASM, and physical WebGPU validation     |
| INT8    |   Not distributed | None         | precision acceptance failed; absent from the default manifest                                           |

FP16 keeps graph inputs and outputs in FP32 and preserves sensitive operators such as Resize in FP32. Fully automatic selection prefers WebGPU FP16 when `shader-f16` is available, can use WebGPU FP32 without it, and can fall back to WASM FP32 after runtime failure. Manual backend or precision choices are strict and are never silently rewritten. The upstream model is float32, not FP64; FP64 inference is unsupported. FP32 is about twice the size of FP16, may be slower, and uses more GPU memory. Historical `1.0.0` model assets remain unchanged.

The upstream PaddlePaddle `PP-DocLayoutV3_safetensors` metadata declares Apache-2.0. This project distributes converted artifacts under Apache-2.0 as well; users should preserve the attribution and citation in [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md).
