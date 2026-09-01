# Models and precision

[中文](../zh-CN/models.md)

The current manifest is `models/pp-doclayoutv3/manifest.json`, with both ONNX files in the same root directory. It is updated together with the model files; `model.version`, source revisions, hashes, and validation reports remain metadata and evidence rather than directory names. Its architecture is `PPDocLayoutV3ForObjectDetection`, it has 33,175,165 parameters, and its FP32 input is `[1, 3, 800, 800]`. Outputs contain class scores, boxes, reading-order logits, and segmentation masks.

| Variant |              Size | Backend      | Status                                                                                              |
| ------- | ----------------: | ------------ | --------------------------------------------------------------------------------------------------- |
| FP16    |  74,279,796 bytes | WASM, WebGPU | CPU acceptance plus real browser WASM and WebGPU validation passed                                  |
| FP32    | 142,574,928 bytes | WASM, WebGPU | seven acceptance images passed official parity, strict browser WASM, and physical WebGPU validation |
| INT8    |   Not distributed | None         | precision acceptance failed; absent from the default manifest                                       |

FP16 keeps graph inputs and outputs in FP32 and preserves sensitive operators such as Resize in FP32. It is about half the size of FP32 and is available on both WebGPU and WASM/CPU; CPU execution may be slower depending on the device. Fully automatic selection prefers WebGPU FP16 when `shader-f16` is available, can use WebGPU FP32 without it, and can fall back to WASM FP16 or FP32 after runtime failure. Manual backend or precision choices are strict and are never silently rewritten. The upstream model is float32, not FP64; FP64 inference is unsupported. FP32 is about twice the size of FP16, may be slower, and uses more GPU memory. Historical versions remain only in benchmark/report evidence and are not current download paths.

The upstream PaddlePaddle `PP-DocLayoutV3_safetensors` metadata declares Apache-2.0. This project distributes converted artifacts under Apache-2.0 as well; users should preserve the attribution and citation in [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md).
