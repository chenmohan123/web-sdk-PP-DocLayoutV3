# Troubleshooting

[中文](../zh-CN/troubleshooting.md)

## Download failure or stalled progress

Check that the immutable URL is reachable, returns 200, includes `Content-Length`, allows the page Origin through CORS, and is not mixed HTTP content on an HTTPS page. Clear model cache and retry; never put a `latest` URL in a production manifest.

## WebGPU is unavailable

Call `probeDocLayoutCapabilities()` and inspect `webgpu`, `webgpuFp16`, and `diagnostics`. Check the secure context, GPU driver, and `shader-f16`, or set `backend: "wasm"`. Auto mode records `runtime.fallbacks`; fallback is explicit, not a silently software-backed GPU.

## Multithreaded WASM fails

Check `crossOriginIsolated`, COOP/COEP, and CORS/CORP for Worker and WASM assets. First validate the model contract with single-thread WASM, then restore isolation one policy at a time.

## Custom manifest is invalid

Use `parseModelManifest()` and check schemaVersion, `[1,3,800,800]` input, four outputs, 25 labels, opset, byte count, and SHA-256. An ONNX graph opening in ONNX Runtime does not prove postprocessing compatibility.

## WeChat H5/WebView

The page must use an HTTPS business domain, and model/WASM hosts must be allow-listed. The native mini-program runtime does not provide the DOM, Worker, and WebGPU/WASM page surface this SDK needs. Use an Official Account H5 page or mini-program `web-view`; do not claim native mini-program inference.

## Out of memory or cancellation

Keep one detector per page and `await detector.dispose()` after detection or page teardown. Use an `AbortController` to cancel loading/detection, and create a fresh controller for the next operation.
