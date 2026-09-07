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

For default model `1.0.2`, `webgpu` supports validated `fp16` and `fp32`, while `wasm` (CPU) supports validated `fp16` and `fp32`. Auto mode prefers WebGPU FP16 when `shader-f16` is available, can use WebGPU FP32 without it, and falls back to WASM FP16 or FP32 after runtime failure. Explicit pairs absent from the manifest throw `CAPABILITY_UNSUPPORTED`. `allowFallback` handles runtime failures among valid candidates; it does not rewrite an invalid pair. The Demo enables fallback only for Auto backend + Auto precision, so any manual Demo backend or precision choice remains strict. The source model is float32; FP64 inference is unsupported.

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

- `detect(image, { threshold, classThresholds, signal })`: accepts a Blob, CanvasImageSource, or normalized raster.
- `dispose()`: waits for queued work and releases the Worker/session; it is idempotent.
- `listModelCache()` / `clearModelCache()`: inspect or clear every SDK model in the detector's cache manager, preserving the existing clear-all semantics.
- `clearCurrentModelCache()` / `estimateModelCache()`: clear or measure all precisions of the loaded model ID and version.
- `clearAllModelCache()`: equivalent to the existing `clearModelCache()`.
- `model`, `runtime`, `capabilities`, `loadTimings`: actual loaded configuration.

```ts
import type { DocLayoutDetector } from "web-sdk-pp-doclayoutv3";

declare const detector: DocLayoutDetector;
declare const file: Blob;

const result = await detector.detect(file, {
  threshold: 0.5,
  classThresholds: {
    formula: 0.4,
    table: 0.55,
    text: 0.6
  }
});
```

`classThresholds` overrides confidence filtering for matching manifest label names and falls back to `threshold` for unspecified classes. The global `threshold` still controls mask binarization and polygon extraction. Unknown class names and values outside `0` through `1` are rejected.

## Other exports

The top-level `clearCurrentModelCache({ modelId, version })` matches one model and version exactly. `clearAllModelCache()` clears all models belonging to this SDK; `clearModelCache()` keeps the same clear-all semantics. Ordinary cache keys remain compatible. Identity segments containing `:` or `%` are encoded separately; ambiguous legacy keys can only be removed by the SDK clear-all action. Default detectors and top-level APIs share a cache manager in the current JavaScript context, including memory fallback after persistence failure. A detector created with `cache: false` has an isolated manager and must be cleared through its instance.

`estimateModelCache(identity?)` returns `bytes` (memory plus persistent copies), `memoryBytes`, `persistentBytes`, and `entryCount` (unique keys). Omitting the identity measures all SDK models. Measurements use model byte metadata and exclude ONNX sessions, images, and browser storage overhead. Optional `originUsageBytes` and `originQuotaBytes` come from `navigator.storage.estimate()` and describe the entire origin, not the SDK cache.

```ts
import {
  clearCurrentModelCache,
  clearAllModelCache,
  estimateModelCache
} from "web-sdk-pp-doclayoutv3";

const identity = { modelId: "pp-doclayoutv3", version: "1.0.2" };
const usage = await estimateModelCache(identity);
await clearCurrentModelCache(identity);
await clearAllModelCache();
```

Clearing prevents previously started downloads in the same manager from repopulating the cache, but does not dispose active detector sessions. The Demo first cancels and awaits the task, calls `dispose()` to release its Worker/session, then clears the cache. Callers must coordinate active tasks in other tabs or JavaScript contexts. SDK clear-all leaves other SDKs' Cache Storage untouched.

`loadTimings.modelCacheReadMs` is the standard cache-read timing. `modelCacheMs` remains an equal-valued compatibility field. Both exclude SHA-256 verification.

`probeDocLayoutCapabilities()`, `listModelCache()`, `clearModelCache()`, `parseModelManifest()`, `DocLayoutError`, default manifest/WASM URLs, and all public TypeScript contracts. Runtime messages remain stable English strings; localize UI using `error.code`.
