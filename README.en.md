# web-sdk-PP-DocLayoutV3

[中文](README.md)

A TypeScript SDK that runs PP-DocLayoutV3 in the browser with ONNX Runtime Web. The default path loads a versioned manifest, prefers WebGPU with FP16, and can fall back to WASM/CPU with FP16 and then FP32 in fully automatic mode when capabilities or session creation require it.

> Supported surfaces include desktop and mobile browsers, WeChat Official Account H5 pages, and mini-program `web-view` pages. It does not support native mini-program inference.

## Install and use with zero configuration

```bash
pnpm add web-sdk-pp-doclayoutv3
```

```ts
import { createDocLayout, DocLayoutError } from "web-sdk-pp-doclayoutv3";

const detector = await createDocLayout({
  onProgress(event) {
    console.log(event.phase, event.status, event.loadedBytes, event.totalBytes);
  }
});

try {
  const file = document.querySelector<HTMLInputElement>("input[type=file]")!.files![0]!;
  const result = await detector.detect(file, { threshold: 0.5 });
  console.log(result.detections, result.runtime, result.timings);
} catch (error) {
  if (error instanceof DocLayoutError) console.error(error.code, error.details);
} finally {
  await detector.dispose();
}
```

After initialization, `detector.loadTimings` exposes the timing breakdown. `totalMs` is the full initialization duration and `modelMs` is the aggregate model acquisition and verification duration. `modelDownloadMs`, `modelCacheMs`, `integrityMs`, and `sessionMs` measure network download, cache reads, SHA-256 verification, and ONNX Runtime Session creation. `modelSource` identifies `network`, `cache`, `memory`, or `custom`.

## Manual selection and custom models

Set `backend` to `auto`, `webgpu`, or `wasm`, and `precision` to `auto`, `fp16`, or `fp32`. `allowFallback` defaults to `true` for fully automatic selection and `false` when a backend or precision is explicit; set it to `true` to permit fallback across valid candidates. A model can be a manifest URL, a manifest object, or an in-memory `{ manifest, data }` pair. Custom models must preserve the documented tensor and postprocessing contract.

The default support matrix is WebGPU + FP16 and CPU/WASM + FP16 or FP32. FP16 is smaller on CPU, but it is not necessarily faster than FP32. With the default model, the SDK rejects explicit pairs absent from the manifest with `CAPABILITY_UNSUPPORTED`; `allowFallback` only tries valid manifest candidates. The live Demo enables runtime fallback only for Auto backend + Auto precision. Any manual backend or precision choice is strict: GPU disables FP32, while CPU supports both FP16 and FP32. Automatic candidates are WebGPU FP16, WebGPU FP32 when declared, WASM FP16, validated WASM INT8 when declared, and WASM FP32. Custom manifests are governed by their included, passing variants.

The default FP16 model is 74,279,796 bytes and targets WebGPU and WASM/CPU. The FP32 model is 143,216,104 bytes and targets WASM/CPU. FP16 passed CPU precision acceptance plus real browser WASM and WebGPU validation. FP32 passed numerical parity and browser WASM validation, but no physical WebGPU FP32 validation has been recorded. The upstream PaddlePaddle `PP-DocLayoutV3_safetensors` model is Apache-2.0; see [Models](docs/en/models.md) and [Third-Party Notices](THIRD_PARTY_NOTICES.md).

## Deployment and privacy

Inference stays in the user's browser; the SDK does not upload document images to this project's servers. Default model downloads require HTTPS and correct CORS headers, and model caching uses IndexedDB. Configure COOP/COEP to obtain `crossOriginIsolated` and multithreaded WASM. The first load downloads roughly 71 MB or 137 MB, so mobile-network products should ask for user consent.

Recorded real WebGPU evidence used Windows, Chrome 151, an NVIDIA Blackwell adapter, and ONNX Runtime Web 1.27.0. One FP16 sample measured about 440 ms download, 1785 ms session creation, and 682 ms inference. This is not a cross-device benchmark; the 1.0.0 release validation will publish the full matrix.

## Documentation

- [Quick start](docs/en/quick-start.md)
- [API](docs/en/api.md)
- [Compatibility](docs/en/compatibility.md)
- [Models and precision](docs/en/models.md)
- [Model conversion](docs/en/conversion.md)
- [Custom models](docs/en/custom-models.md)
- [Deployment](docs/en/deployment.md)
- [Performance](docs/en/performance.md)
- [Error codes](docs/en/errors.md)
- [Troubleshooting](docs/en/troubleshooting.md)
- [CDN, Vite, React, Vue, and WeChat H5 examples](examples/)

## Development

```bash
pnpm install --frozen-lockfile
pnpm verify
```

Project code and ONNX derivatives are released under Apache-2.0. See `THIRD_PARTY_NOTICES.md` for upstream attribution.
