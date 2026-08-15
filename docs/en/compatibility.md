# Compatibility

[中文](../zh-CN/compatibility.md)

| Environment                                          | Backend                                  | Notes                                                                     |
| ---------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------- |
| Current desktop Chrome/Edge                          | WebGPU, WASM                             | WebGPU preferred; HTTPS or localhost required                             |
| Safari on macOS/iOS                                  | WASM; WebGPU depends on version          | Trust `probeDocLayoutCapabilities()`                                      |
| Firefox                                              | WASM; WebGPU depends on version/settings | Trust runtime probing                                                     |
| Android WebView/mobile browser                       | Usually WASM                             | FP16 is the smaller default option; account for CPU speed and memory peak |
| WeChat Official Account H5 / mini-program `web-view` | Usually WASM                             | Must be a web context; it does not support native mini-program inference  |

| Default-model backend | FP16      | FP32          |
| --------------------- | --------- | ------------- |
| WebGPU                | Supported | Not validated |
| CPU (WASM)            | Supported | Supported     |

WebGPU FP16 requires `navigator.gpu` and `shader-f16`. WASM/CPU supports both bundled FP16 and FP32 variants; FP16 downloads roughly half as many bytes, but CPU throughput depends on the browser and device. Fully automatic selection prefers WebGPU FP16, then WASM FP16, and then WASM FP32 for the bundled manifest. The Demo makes every manual backend or precision choice strict, disables unsupported default pairs, and corrects an invalid precision with a notice when the backend changes. The SDK rejects explicit pairs absent from the default manifest with `CAPABILITY_UNSUPPORTED`. Strictly requesting unavailable capabilities can produce `CAPABILITY_UNSUPPORTED` or `MODEL_INCOMPATIBLE`.

Single-thread WASM does not require cross-origin isolation. Multithreaded WASM needs COOP `same-origin` plus COEP `require-corp` or `credentialless`; model, WASM, and Worker assets must also satisfy same-origin/CORS/CORP rules. The SDK chooses threads from actual capabilities instead of assuming every mobile WebView has SharedArrayBuffer.
