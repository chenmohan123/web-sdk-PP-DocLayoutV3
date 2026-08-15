# Compatibility

[中文](../zh-CN/compatibility.md)

| Environment                                          | Backend                                  | Notes                                                                    |
| ---------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------ |
| Current desktop Chrome/Edge                          | WebGPU, WASM                             | WebGPU preferred; HTTPS or localhost required                            |
| Safari on macOS/iOS                                  | WASM; WebGPU depends on version          | Trust `probeDocLayoutCapabilities()`                                     |
| Firefox                                              | WASM; WebGPU depends on version/settings | Trust runtime probing                                                    |
| Android WebView/mobile browser                       | Usually WASM                             | FP16 is smaller; account for CPU speed and memory peak                   |
| WeChat Official Account H5 / mini-program `web-view` | Usually WASM                             | Must be a web context; it does not support native mini-program inference |

| Default-model backend | FP16      | FP32      |
| --------------------- | --------- | --------- |
| WebGPU                | Supported | Supported |
| CPU (WASM)            | Supported | Supported |

WebGPU FP16 requires `navigator.gpu` and `shader-f16`; WebGPU FP32 does not require `shader-f16`. WASM/CPU supports both validated FP16 and FP32 variants. Fully automatic selection prefers FP16 when available, uses WebGPU FP32 without it, and can fall back to WASM FP16 or FP32 after runtime failure. The Demo makes every manual backend or precision choice strict, disables unsupported default pairs, and corrects an invalid precision with a notice when the backend changes. The SDK rejects explicit pairs absent from the default manifest with `CAPABILITY_UNSUPPORTED`. Strictly requesting unavailable capabilities can produce `CAPABILITY_UNSUPPORTED` or `MODEL_INCOMPATIBLE`. The source model is float32; FP64 is unsupported.

Single-thread WASM does not require cross-origin isolation. Multithreaded WASM needs COOP `same-origin` plus COEP `require-corp` or `credentialless`; model, WASM, and Worker assets must also satisfy same-origin/CORS/CORP rules. The SDK chooses threads from actual capabilities instead of assuming every mobile WebView has SharedArrayBuffer.
