# API

[中文](../zh-CN/api.md)

All stable entry points are exported from the package root. Do not import `src/` or other internal files.

## `createDocLayout(options?)`

Returns a `Promise<DocLayoutDetector>`. Common options:

- `backend`: `"auto" | "webgpu" | "wasm"`
- `precision`: `"auto" | "fp16" | "fp32" | "int8"`; the default manifest has no INT8 variant
- `allowFallback`: whether session failures try the next candidate; defaults to `true`
- `model`: manifest URL, manifest object, or `{ manifest, data }`
- `cache`: enable or disable model caching
- `signal`: cancel loading
- `onProgress`: capability, manifest, model, session, fallback, and ready phases
- `ort.wasm`: WASM asset paths and thread options

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
