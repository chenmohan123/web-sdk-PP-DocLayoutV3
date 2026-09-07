# Changelog

## 1.2.0

发布说明：[1.2.0](docs/releases/1.2.0.md)。

- 清理缓存或清空检测结果时，画布同步恢复原图，避免继续显示旧检测框。
- 加载、推理及切换来源期间禁用自定义清单应用，并取消迟到的初始化清单请求，避免旧会话覆盖当前模型的缓存身份。
- 损坏缓存的异步校验按清理代次保护删除，避免旧校验移除清理后写入的新缓存。
- 新增标准耗时字段 `modelCacheReadMs`，保留同值的 `modelCacheMs` 兼容字段。
- 新增 `clearCurrentModelCache(identity)`、`clearAllModelCache()` 和 `estimateModelCache(identity?)`；原 `clearModelCache()` 保持 SDK 全清语义。当前模型清理按模型 ID 和版本匹配全部精度，容量区分 SDK 内存、持久缓存与源站配额。
- Demo 展示当前模型缓存容量、当前模型清理和 SDK 全清控件；清理会取消并等待当前任务、释放 Worker 会话，显示忙碌和失败状态，避免旧下载回填。

## 1.1.0

- Added per-class confidence thresholds through `classThresholds`, with fallback to the global `threshold` and then `0.5`; the global threshold continues to control mask binarization and polygon extraction.
- Added a responsive Demo editor for active class thresholds, including blank-value inheritance, clear-all support, and bilingual accessible controls.

## 1.0.6

- Added validated CPU/WASM support for the bundled FP16 model through immutable model manifest `1.0.2`, reusing the published `1.0.1` model binaries.
- Kept WebGPU FP16 and FP32 support while expanding the default CPU/WASM matrix to FP16 and FP32.

## 1.0.5

- Adopted immutable PP-DocLayoutV3 model `1.0.1`, enabling validated strict WebGPU FP32 execution while retaining WebGPU FP16 as the preferred automatic path.
- Versioned model validation evidence and Pages staging so historical `1.0.0` assets remain unchanged.

## 1.0.4

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
