# Error codes

[中文](../zh-CN/errors.md)

Runtime messages remain English. Localize application UI using the stable `DocLayoutError.code`. The following table is maintained from the single source `docs/error-codes.json`:

| Code                     | Meaning                                                      | Recommended action                                                              |
| ------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `CAPABILITY_UNSUPPORTED` | The browser lacks the required WebGPU or WASM capability.    | Upgrade the browser, select WASM, or check the secure context.                  |
| `MANIFEST_INVALID`       | The model manifest has an invalid schema, version, or field. | Fix the JSON against the manifest contract and check minSdkVersion.             |
| `MODEL_INCOMPATIBLE`     | No model variant matches the selected backend and precision. | Allow fallback or provide a compatible FP32/FP16 variant.                       |
| `MODEL_DOWNLOAD_FAILED`  | Downloading the model or manifest failed.                    | Check the URL, network, HTTPS, CORS, and response status.                       |
| `MODEL_INTEGRITY_FAILED` | The model size or SHA-256 does not match the manifest.       | Clear the cache and download again from a trusted immutable URL.                |
| `IMAGE_INVALID`          | The image cannot be decoded or has an invalid input format.  | Use a valid PNG, JPEG, WebP, Blob, or CanvasImageSource.                        |
| `SESSION_CREATE_FAILED`  | Creating the ONNX Runtime session failed.                    | Check model operators and WASM asset paths, then allow fallback.                |
| `INFERENCE_FAILED`       | Inference failed, or an operation used a disposed detector.  | Inspect details, input dimensions, and lifecycle; recreate the detector.        |
| `OUT_OF_MEMORY`          | The browser ran out of memory.                               | Dispose old detectors, close other tabs, use FP16, or run on desktop.           |
| `ABORTED`                | Loading or detection was cancelled by an AbortSignal.        | Retry only when needed and create a new AbortController for the next operation. |

```ts
import { DocLayoutError } from "web-sdk-pp-doclayoutv3";

export function errorLabel(error: unknown): string {
  if (!(error instanceof DocLayoutError)) return "UNKNOWN";
  return `${error.code}: ${error.message}`;
}
```
