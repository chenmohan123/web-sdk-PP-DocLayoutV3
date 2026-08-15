# Deployment

[中文](../zh-CN/deployment.md)

Deploy the SDK and Demo over HTTPS (localhost is exempt). The manifest, ONNX files, ONNX Runtime WASM assets, and Worker need correct MIME types and CORS. A cross-origin model host must return an `Access-Control-Allow-Origin` value that permits the page origin.

Models are large assets. Recommended policy:

- Use immutable version URLs, never `latest`.
- Give hash-addressed ONNX files long immutable caching; use controlled short caching or a versioned URL for manifests.
- Preserve `Content-Length` so download progress is accurate.
- Allow IndexedDB. The SDK can run when it is unavailable, but may download again.
- Before mobile-network downloads, disclose 74,279,796 bytes for FP16 and 142,574,928 bytes for FP32.

The bundled SDK uses the versioned `models/v1.0.2/manifest.json`. That manifest reuses model binaries from the immutable `v1.0.1-models` release and adds validated WASM compatibility metadata for FP16; deployments must preserve the historical `models/v1.0.0/` and `models/v1.0.1/` paths alongside the current `models/v1.0.2/` path for existing SDK consumers.

Multithreaded WASM requires:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Before enabling COOP/COEP, check third-party iframes, analytics, and images for CORP/CORS compatibility. Use single-thread WASM when isolation is unavailable instead of breaking authentication or embedding.

For WeChat, deploy an HTTPS H5 page for an Official Account or a mini-program `web-view`, and configure the business domain. It does not support native mini-program inference. GPU capabilities vary across iOS and Android WebViews, so rely on probing and WASM fallback.

Document images stay in browser inference and are not sent to this project's servers. Application owners must still audit their own analytics, logging, and error reporting so document images and unsanitized results are not captured.
