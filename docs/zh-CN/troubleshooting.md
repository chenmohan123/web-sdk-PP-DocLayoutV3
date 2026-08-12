# 故障排查

[English](../en/troubleshooting.md)

## 下载失败或进度不动

检查固定 URL 是否可访问、响应是否为 200、是否有 `Content-Length`、CORS 是否允许当前 Origin，以及 HTTPS 页面是否混入 HTTP 资源。清除模型缓存后重试；不要把 `latest` 地址写入生产清单。

## WebGPU 不可用

调用 `probeDocLayoutCapabilities()` 查看 `webgpu`、`webgpuFp16`、`diagnostics`。确认浏览器安全上下文、GPU 驱动和 `shader-f16`，或手动设置 `backend: "wasm"`。自动模式会记录 `runtime.fallbacks`，回退不是静默的软件假 GPU。

## WASM 多线程失败

检查 `crossOriginIsolated`、COOP/COEP、Worker 和 WASM 的 CORS/CORP。先使用单线程 WASM 验证模型契约，再逐项恢复隔离策略。

## 自定义清单无效

使用 `parseModelManifest()`，核对 schemaVersion、输入 `[1,3,800,800]`、四个输出、25 个标签、opset、字节数和 SHA-256。模型能被 ONNX Runtime 打开不代表后处理契约正确。

## 微信 H5/WebView

页面必须是 HTTPS 业务域名，模型和 WASM 下载域名需加入允许列表。微信小程序原生运行环境不提供本 SDK 所需的 DOM、Worker 和 WebGPU/WASM 页面能力；请使用公众号 H5 或小程序 `web-view`，不要宣称原生小程序推理。

## 内存不足或取消

单页只保留一个检测器，检测完成或离开页面时 `await detector.dispose()`。用 `AbortController` 取消下载/检测，取消后为下一次操作创建新的 controller。
