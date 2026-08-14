# Changelog

## Unreleased

- Prevented explicit CPU/WASM + FP16 selection because the validated FP16 model is WebGPU-only.
- Updated the Demo to disable FP16 for CPU and explain automatic switching to FP32.
- Synchronized the backend/precision support matrix across SDK and repository documentation.

## 1.0.2

- Added separate model download, cache read, integrity verification, and Session creation timings through `detector.loadTimings`.
- Added `modelSource` metadata for network, persistent cache, memory cache, and custom in-memory models.
- Added official PaddleOCR sample documents to the Demo and fixed sample loading under the GitHub Pages base path.
- Published the SDK with bilingual README documentation for the detailed load timing fields.

## 1.0.1

- Added Chinese-first bilingual npm package documentation.
- Migrated npm releases to GitHub Actions Trusted Publishing with provenance and no npm token.
- Served validated FP16 and FP32 model assets from GitHub Pages so browsers can load the built-in model without CORS failures.

## 1.0.0 (release candidate)

- Added browser-first PP-DocLayoutV3 SDK runtime with WASM/WebGPU backend selection.
- Added FP32 and FP16 model contracts, custom manifests, caching, workers, bilingual docs, demos, and consumer examples.
- Added release workflows, model validation reports, and an auditable real-model benchmark workflow.
- Passed the 1.0.0 runtime benchmark gate for FP32/WASM, FP16/WebGPU on NVIDIA hardware, and responsive screenshots. Publishing model assets, npm, tags, and Pages remains a separate authorized release step.
