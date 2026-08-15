# API

[中文](../zh-CN/api.md)

All stable entry points are exported from the package root. Do not import `src/` or other internal files.

## `createDocLayout(options?)`

Returns a `Promise<DocLayoutDetector>`. Common options:

- `backend`: `"auto" | "webgpu" | "wasm"`
- `precision`: `"auto" | "fp16" | "fp32" | "int8"`; the default manifest has no INT8 variant
- `allowFallback`: whether session failures try the next valid candidate; defaults to `true` for fully automatic selection and `false` when backend or precision is explicit
- `model`: manifest URL, manifest object, or `{ manifest, data }`
- `cache`: enable or disable model caching
- `signal`: cancel loading
- `onProgress`: capability, manifest, model, session, fallback, and ready phases
- `ort.wasm`: WASM asset paths and thread options

For `phase: "model"` and `status: "progress"`, `loadedBytes` and the optional `totalBytes` describe model network-transfer bytes only, not overall initialization progress. They exclude integrity verification and ONNX Runtime Session creation. `totalBytes` can be absent when the response has no `Content-Length`, and cache, memory, or custom binary model sources may emit no byte progress.

For the default model, `webgpu` supports `fp16`, while `wasm` (CPU) supports both `fp16` and `fp32`. Explicit pairs absent from the manifest throw `CAPABILITY_UNSUPPORTED`. `allowFallback` handles runtime failures among valid candidates; it does not rewrite an invalid pair. Automatic selection prefers WebGPU FP16, then WASM FP16, then WASM FP32 for the bundled manifest. The Demo enables fallback only for Auto backend + Auto precision, so any manual Demo backend or precision choice remains strict.

```ts
import { createDocLayout } from "web-sdk-pp-doclayoutv3";

const detector = await createDocLayout({
  backend: "wasm",
  precision: "fp32",
  allowFallback: false,
  onProgress: ({ phase, status }) => console.log(phase, status)
});
await detector.dispose();
```

## `DocLayoutDetector`

- `detect(image, { threshold, signal })`: accepts a Blob, CanvasImageSource, or normalized raster.
- `dispose()`: waits for queued work and releases the Worker/session; it is idempotent.
- `listModelCache()` / `clearModelCache()`: inspect or clear the detector's model cache.
- `model`, `runtime`, `capabilities`, `loadTimings`: actual loaded configuration.

## Other exports

`probeDocLayoutCapabilities()`, `listModelCache()`, `clearModelCache()`, `parseModelManifest()`, `DocLayoutError`, default manifest/WASM URLs, and all public TypeScript contracts. Runtime messages remain stable English strings; localize UI using `error.code`.
