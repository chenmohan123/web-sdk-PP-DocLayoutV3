# 部署

[English](../en/deployment.md)

SDK 和 Demo 必须部署在 HTTPS（localhost 除外）。模型清单、ONNX、ONNX Runtime WASM 和 Worker 需要正确的 MIME 类型及 CORS；跨域模型服务器至少返回允许页面域名的 `Access-Control-Allow-Origin`。

模型是大文件，建议：

- 将清单与两个 ONNX 发布到同一当前模型根目录，并在更新时一起替换。
- 为根目录清单和 ONNX 使用可控缓存或明确的查询 revision，避免更新时混用新旧文件。
- 保留 `Content-Length`，使加载进度准确。
- 允许 IndexedDB；禁用或受限时 SDK 仍可运行，但会重复下载。
- 在移动网络下载前告知用户 FP16 74,279,796 字节、FP32 142,574,928 字节。

内置 SDK 使用当前的 `models/manifest.json`。模型文件与清单位于同一根目录，更新模型时一起替换；清单仍保留 `model.version`、文件大小、SHA-256 和来源 revision 作为完整性证据。

多线程 WASM 需要：

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

启用 COOP/COEP 前应检查第三方 iframe、分析脚本和图片是否兼容 CORP/CORS。无法跨源隔离时使用单线程 WASM，不要为了线程支持破坏现有登录或嵌入流程。

微信场景部署为微信公众号 H5 或小程序 `web-view` 的 HTTPS 页面，并配置业务域名。它不支持微信小程序原生推理。iOS/Android WebView 的 GPU 能力差异较大，应以运行时探测和 WASM 回退为准。

图片在浏览器本地推理，不会上传到本项目服务器；业务代码仍应审计自身的日志、埋点和错误上报，避免记录文档图片或未脱敏结果。
