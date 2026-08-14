# Models and precision

[中文](../zh-CN/models.md)

The default manifest is fixed at `pp-doclayoutv3/1.0.0`. Its architecture is `PPDocLayoutV3ForObjectDetection`, it has 33,175,165 parameters, and its FP32 input is `[1, 3, 800, 800]`. Outputs contain class scores, boxes, reading-order logits, and segmentation masks.

| Variant |              Size | Backend | Status                                                                                   |
| ------- | ----------------: | ------- | ---------------------------------------------------------------------------------------- |
| FP16    |  74,279,796 bytes | WebGPU  | 155/155 detections matched across seven acceptance images; real WebGPU validation passed |
| FP32    | 143,216,104 bytes | WASM    | official parity and browser WASM validation passed; physical WebGPU not recorded         |
| INT8    |   Not distributed | None    | precision acceptance failed; absent from the default manifest                            |

FP16 keeps graph inputs and outputs in FP32 and preserves sensitive operators such as Resize in FP32. Fully automatic selection prefers WebGPU FP16 when `shader-f16` is available and can fall back to WASM FP32. The default manifest has no validated WebGPU FP32 or WASM FP16 pair, so explicit requests for either fail with `CAPABILITY_UNSUPPORTED`. A custom manifest may enable either pair after separate validation.

The upstream PaddlePaddle `PP-DocLayoutV3_safetensors` metadata declares Apache-2.0. This project distributes converted artifacts under Apache-2.0 as well; users should preserve the attribution and citation in [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md).
