# Model Progress Status Design

## Problem

The Demo currently renders `加载模型中 56%` while the percentage is calculated only from `loadedBytes / totalBytes`. The wording implies that the percentage covers the whole model initialization process, although it measures network transfer only. The Demo also switches to `检测中` when Session creation starts, before image detection has actually begun.

## Selected Design

Present three sequential user-facing states:

1. `模型下载中 56%` while a model download progress event provides `loadedBytes` and `totalBytes`.
2. `模型加载中` while model verification and ONNX Runtime Session creation are running.
3. `检测中` only after detector initialization completes and `detector.detect()` begins.

English copy uses `Downloading model 56%`, `Loading model`, and `Detecting`.

## Cache And Custom Models

- A memory or persistent cache hit does not show a download percentage. It proceeds from model preparation to `模型加载中`.
- An in-memory custom model does not show a download percentage.
- If a server does not provide `Content-Length`, the Demo shows `模型下载中` without a percentage rather than displaying a misleading `0%`.
- Integrity verification remains part of `模型加载中`; it is not exposed as a separate status.

## Event Mapping

- `model` with byte progress: downloading model, optionally with a percentage.
- `model` without byte progress: preparing/loading model without a percentage.
- `session`: loading model without a percentage.
- `ready`: initialization is complete.
- `preprocess`, `inference`, or `postprocess`: detecting.

The SDK progress event contract does not change. The Demo only interprets the existing `phase`, `status`, `loadedBytes`, and `totalBytes` fields more precisely.

## Documentation

Update the Chinese and English API documentation and the bilingual SDK README to clarify that `loadedBytes` and `totalBytes` describe model download bytes, not overall initialization progress.

## Testing

Browser tests verify the download label with a percentage, the loading label during Session creation, and the detecting label after initialization. Existing CPU/FP16, full detection, localization, and responsive tests must remain green. SDK tests continue to verify the unchanged progress event contract.
