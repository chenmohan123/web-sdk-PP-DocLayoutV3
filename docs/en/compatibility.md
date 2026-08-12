# Compatibility

[中文](../zh-CN/compatibility.md)

| Environment                                          | Backend                                  | Notes                                                                    |
| ---------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------ |
| Current desktop Chrome/Edge                          | WebGPU, WASM                             | WebGPU preferred; HTTPS or localhost required                            |
| Safari on macOS/iOS                                  | WASM; WebGPU depends on version          | Trust `probeDocLayoutCapabilities()`                                     |
| Firefox                                              | WASM; WebGPU depends on version/settings | Trust runtime probing                                                    |
| Android WebView/mobile browser                       | Usually WASM                             | Account for the 137 MB FP32 download and memory peak                     |
| WeChat Official Account H5 / mini-program `web-view` | Usually WASM                             | Must be a web context; it does not support native mini-program inference |

WebGPU FP16 requires `navigator.gpu` and `shader-f16`. Strictly requesting an unavailable capability can produce `CAPABILITY_UNSUPPORTED` or `MODEL_INCOMPATIBLE`.

Single-thread WASM does not require cross-origin isolation. Multithreaded WASM needs COOP `same-origin` plus COEP `require-corp` or `credentialless`; model, WASM, and Worker assets must also satisfy same-origin/CORS/CORP rules. The SDK chooses threads from actual capabilities instead of assuming every mobile WebView has SharedArrayBuffer.
