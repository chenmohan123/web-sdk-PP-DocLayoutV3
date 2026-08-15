# 兼容性

[English](../en/compatibility.md)

| 环境                             | 后端                         | 说明                                       |
| -------------------------------- | ---------------------------- | ------------------------------------------ |
| Chrome/Edge 桌面最新版           | WebGPU、WASM                 | WebGPU 优先；需 HTTPS 或 localhost         |
| Safari/macOS/iOS                 | WASM；WebGPU 取决于版本      | 以 `probeDocLayoutCapabilities()` 结果为准 |
| Firefox                          | WASM；WebGPU 取决于版本/设置 | 以运行时探测为准                           |
| Android WebView/移动浏览器       | 通常 WASM                    | 注意约 136 MiB FP32 下载和内存峰值         |
| 微信公众号 H5、小程序 `web-view` | 通常 WASM                    | 必须是网页上下文；不支持微信小程序原生推理 |

| 默认模型后端 | FP16   | FP32 |
| ------------ | ------ | ---- |
| WebGPU       | 支持   | 支持 |
| CPU（WASM）  | 不支持 | 支持 |

WebGPU FP16 需要 `navigator.gpu` 和 `shader-f16`；WebGPU FP32 不需要 `shader-f16`。全自动选择在具备 `shader-f16` 时优先 FP16，没有该能力时可用 FP32，并在运行时失败后回退到 WASM FP32。Demo 对任何手动后端或精度选择都严格执行，会禁用默认模型不支持的组合；切换后端时若当前精度无效，会改选已验证精度并提示。SDK 会以 `CAPABILITY_UNSUPPORTED` 拒绝默认清单中不存在的显式组合。手动要求不可用能力时，会抛出 `CAPABILITY_UNSUPPORTED` 或 `MODEL_INCOMPATIBLE`。原始模型是 float32，不支持 FP64。

WASM 单线程不要求跨源隔离。多线程 WASM 需要 COOP `same-origin` 与 COEP `require-corp` 或 `credentialless`，并要求模型、WASM、Worker 资源满足同源/CORS/CORP 规则。SDK 会根据实际能力选择线程数，而不是假定所有移动 WebView 都支持 SharedArrayBuffer。
