# Models and precision

[中文](../zh-CN/models.md)

The default manifest is fixed at `pp-doclayoutv3/1.0.1`. Its architecture is `PPDocLayoutV3ForObjectDetection`, it has 33,175,165 parameters, and its FP32 input is `[1, 3, 800, 800]`. Outputs contain class scores, boxes, reading-order logits, and segmentation masks. The `1.0.1` manifest reuses the byte-identical model files from the immutable `v1.0.0-models` release and adds validated WASM compatibility for FP16 without changing the published `1.0.0` contract.

| Variant |              Size | Backend      | Status                                                                           |
| ------- | ----------------: | ------------ | -------------------------------------------------------------------------------- |
| FP16    |  74,279,796 bytes | WASM, WebGPU | CPU acceptance plus real browser WASM and WebGPU validation passed               |
| FP32    | 143,216,104 bytes | WASM         | official parity and browser WASM validation passed; physical WebGPU not recorded |
| INT8    |   Not distributed | None         | precision acceptance failed; absent from the default manifest                    |

FP16 keeps graph inputs and outputs in FP32 and preserves sensitive operators such as Resize in FP32. It is about half the size of FP32 and is available on both WebGPU and WASM/CPU; CPU execution may be slower depending on the device. Fully automatic selection prefers WebGPU FP16 when `shader-f16` is available, then WASM FP16, and finally WASM FP32. The default manifest has no validated WebGPU FP32 pair. A custom manifest may enable other pairs after separate validation.

The upstream PaddlePaddle `PP-DocLayoutV3_safetensors` metadata declares Apache-2.0. This project distributes converted artifacts under Apache-2.0 as well; users should preserve the attribution and citation in [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md).
