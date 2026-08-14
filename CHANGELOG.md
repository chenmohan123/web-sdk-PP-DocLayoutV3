# Changelog

## Unreleased

- Corrected the validated default backend matrix to WebGPU FP16 and WASM FP32, made manual Demo selections strict, and exposed detailed runtime fallback causes.

## 1.0.3

- Fixed explicit backend selection so CPU/WASM requests no longer fall back to WebGPU, and reject unsupported explicit CPU/WASM + FP16 combinations.
- Updated the Demo to disable FP16 for CPU, explain automatic FP32 selection, and show fallback history before long detection result lists.
- Separated model download progress from model loading and grouped initialization and per-detection timings for clearer performance reporting.
- Reorganized the Demo into a denser responsive layout with four sample documents below the image result and a direct GitHub repository link.
- Synchronized the backend/precision support matrix and timing guidance across the SDK README and bilingual repository documentation.
- Updated the development esbuild resolution to 0.28.2 and added a regression check for GHSA-g7r4-m6w7-qqqr.

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
