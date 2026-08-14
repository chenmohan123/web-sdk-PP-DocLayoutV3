# Models and precision

[中文](../zh-CN/models.md)

The default manifest is fixed at `pp-doclayoutv3/1.0.0`. Its architecture is `PPDocLayoutV3ForObjectDetection`, it has 33,175,165 parameters, and its FP32 input is `[1, 3, 800, 800]`. Outputs contain class scores, boxes, reading-order logits, and segmentation masks.

| Variant |              Size | Backend      | Status                                                                                   |
| ------- | ----------------: | ------------ | ---------------------------------------------------------------------------------------- |
| FP16    |  74,279,796 bytes | WebGPU       | 155/155 detections matched across seven acceptance images; real WebGPU validation passed |
| FP32    | 143,216,104 bytes | WebGPU, WASM | parity validation against the official safetensors implementation passed                 |
| INT8    |   Not distributed | None         | precision acceptance failed; absent from the default manifest                            |

FP16 keeps graph inputs and outputs in FP32 and preserves sensitive operators such as Resize in FP32. `auto` prefers FP16 when WebGPU exposes `shader-f16`; otherwise it selects FP32. CPU/WASM has no validated FP16 variant, so an explicit CPU/WASM + FP16 request fails with `CAPABILITY_UNSUPPORTED`; use FP32 for CPU.

The upstream PaddlePaddle `PP-DocLayoutV3_safetensors` metadata declares Apache-2.0. This project distributes converted artifacts under Apache-2.0 as well; users should preserve the attribution and citation in [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md).
