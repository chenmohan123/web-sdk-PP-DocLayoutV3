# 部署

[English](../en/deployment.md)

SDK 和 Demo 必须部署在 HTTPS（localhost 除外）。模型清单、ONNX、ONNX Runtime WASM 和 Worker 需要正确的 MIME 类型及 CORS；跨域模型服务器至少返回允许页面域名的 `Access-Control-Allow-Origin`。

模型是大文件，建议：

- 使用固定版本 URL，不使用 `latest`。
- 为带 hash 的 ONNX 设置长期不可变缓存；清单使用可控的短缓存或版本化 URL。
- 保留 `Content-Length`，使加载进度准确。
- 允许 IndexedDB；禁用或受限时 SDK 仍可运行，但会重复下载。
- 在移动网络下载前告知用户 FP16 74,279,796 字节、FP32 143,216,104 字节。

多线程 WASM 需要：

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

启用 COOP/COEP 前应检查第三方 iframe、分析脚本和图片是否兼容 CORP/CORS。无法跨源隔离时使用单线程 WASM，不要为了线程支持破坏现有登录或嵌入流程。

微信场景部署为微信公众号 H5 或小程序 `web-view` 的 HTTPS 页面，并配置业务域名。它不支持微信小程序原生推理。iOS/Android WebView 的 GPU 能力差异较大，应以运行时探测和 WASM 回退为准。

图片在浏览器本地推理，不会上传到本项目服务器；业务代码仍应审计自身的日志、埋点和错误上报，避免记录文档图片或未脱敏结果。
