# Deployment

[中文](../zh-CN/deployment.md)

Deploy the SDK and Demo over HTTPS (localhost is exempt). The manifest, ONNX files, ONNX Runtime WASM assets, and Worker need correct MIME types and CORS. A cross-origin model host must return an `Access-Control-Allow-Origin` value that permits the page origin.

Models are large assets. Recommended policy:

- Publish the manifest and both ONNX files to the same current-model root, and replace them together.
- Use controlled caching or an explicit query revision for the root manifest and ONNX files so an update cannot mix old and new assets.
- Preserve `Content-Length` so download progress is accurate.
- Allow IndexedDB. The SDK can run when it is unavailable, but may download again.
- Before mobile-network downloads, disclose 74,279,796 bytes for FP16 and 142,574,928 bytes for FP32.

The bundled SDK uses the current `models/manifest.json`. Model files are served from the same root directory and replaced together with the manifest when the current model is updated; `model.version`, byte sizes, SHA-256 values, and source revisions remain in the manifest for integrity evidence.

Multithreaded WASM requires:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Before enabling COOP/COEP, check third-party iframes, analytics, and images for CORP/CORS compatibility. Use single-thread WASM when isolation is unavailable instead of breaking authentication or embedding.

For WeChat, deploy an HTTPS H5 page for an Official Account or a mini-program `web-view`, and configure the business domain. It does not support native mini-program inference. GPU capabilities vary across iOS and Android WebViews, so rely on probing and WASM fallback.

Document images stay in browser inference and are not sent to this project's servers. Application owners must still audit their own analytics, logging, and error reporting so document images and unsanitized results are not captured.
