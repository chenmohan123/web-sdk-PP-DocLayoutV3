# CPU/WASM FP16 Versioned Release Design

## Goal

Allow the bundled PP-DocLayoutV3 FP16 graph to run through ONNX Runtime Web WASM, while preserving the immutable published `1.0.0` model contract and making the new support reachable from the zero-configuration SDK and Demo.

## Versioning

- Keep `models/pp-doclayoutv3/1.0.0/manifest.json` byte-for-byte compatible with the published `v1.0.0-models` release: FP16 supports WebGPU and FP32 supports WASM.
- Add `models/pp-doclayoutv3/1.0.1/manifest.json`. It declares FP16 compatible with WASM and WebGPU, and FP32 compatible with WASM.
- Reuse the unchanged model binaries from the immutable `v1.0.0-models` release. The new manifest version describes newly validated runtime compatibility, not new model weights.
- Prepare a `v1.0.1-models` release containing the new manifest. Pages stages that manifest at `/models/v1.0.1/` and copies its referenced, hash-verified model binaries into the same public directory.
- Bump the SDK to `1.0.5` and point `DEFAULT_MANIFEST_URL` at `/models/v1.0.1/manifest.json`.

## Validation Evidence

The browser validation runner accepts `?backend=webgpu` and `?backend=wasm`. Both modes load the real 74,279,796-byte `model-fp16.onnx`, create an ONNX Runtime Web 1.27.0 session, run the deterministic `[1, 3, 800, 800]` input, and record output names, shapes, types, finite-value checks, and SHA-256 digests.

`browser-evidence.json` stores independent `fp16Webgpu` and `fp16Wasm` records. The variant report includes both records. FP16 may be included in a generated manifest only when CPU precision acceptance, WebGPU browser validation, and WASM browser validation all pass and bind to the same model size and SHA-256.

## Runtime And Demo

Automatic selection remains manifest-driven and uses this order: WebGPU FP16, declared WebGPU FP32, WASM FP16, accepted WASM INT8, WASM FP32. With manifest `1.0.1`, a browser without WebGPU selects WASM FP16. Explicit CPU + FP16 remains strict and selects the FP16 variant without changing precision.

The Demo enables both FP16 and FP32 in CPU mode. Its lightweight fixture proves the control and selection flow; the separate real-model browser evidence proves actual WASM compatibility.

## Deployment Safety

Pages staging must not construct model download URLs from filenames alone. It reads the new manifest from the immutable `v1.0.1-models` release, validates each HTTPS variant URL against the expected GitHub repository release path and filename, downloads the binary, verifies byte length and SHA-256, then rewrites only the staged public URL.

The old `/models/v1.0.0/` contract remains untouched. Release verification checks the SDK/model versions, both browser evidence records, local model hashes, and the staged `1.0.1` paths.

## Documentation

Root, package, API, compatibility, conversion, model, and deployment documentation state that the default `1.0.1` manifest supports WebGPU FP16 plus WASM FP16/FP32. Documentation also states that FP16 reduces download size but may be slower than FP32 on CPU. INT8 remains rejected and unpublished.
