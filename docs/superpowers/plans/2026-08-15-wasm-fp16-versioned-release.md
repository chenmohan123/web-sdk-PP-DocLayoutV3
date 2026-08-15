# CPU/WASM FP16 Versioned Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship validated CPU/WASM FP16 support through a new immutable model manifest and SDK default.

**Architecture:** Extend the real-model browser validator to produce backend-specific evidence, make FP16 inclusion require both WebGPU and WASM evidence, then publish only new compatibility metadata as model manifest `1.0.1` while reusing the immutable `1.0.0` model binaries. SDK `1.0.5`, Pages staging, Demo controls, release contracts, and bilingual docs consume the new manifest.

**Tech Stack:** TypeScript, ONNX Runtime Web 1.27.0, Vitest, Playwright, Python 3.11, pytest, GitHub Pages and Releases.

---

### Task 1: Require Real WASM FP16 Evidence

**Files:**
- Modify: `tools/model-pipeline/tests/test_variants.py`
- Modify: `tools/model-pipeline/ppdoclayout/variant_validation.py`
- Modify: `tools/model-pipeline/browser/runner.mjs`
- Modify: `tools/model-pipeline/browser/index.html`

- [ ] Add failing tests requiring `fp16Wasm` evidence with `executionProvider: "wasm"`, matching model bytes/hash, ORT Web 1.27.0, and valid FP32 output contracts.
- [ ] Run `.venv-model\Scripts\python.exe -m pytest tools/model-pipeline/tests/test_variants.py -q` and confirm FP16 passes without WASM evidence before the implementation.
- [ ] Refactor `_browser_evidence_errors(evidence, model_path, precision, backend)` and require both `fp16Webgpu` and `fp16Wasm` records when computing FP16 `pass` and `included`.
- [ ] Make the browser runner select `ort.webgpu.min.mjs` or `ort.min.mjs` from `?backend=`, create the corresponding execution provider, and emit the same strict output contract.
- [ ] Re-run the focused Python tests and confirm they pass.

### Task 2: Record Real WASM Evidence

**Files:**
- Modify: `tools/model-pipeline/reports/browser-evidence.json`
- Modify: `tools/model-pipeline/reports/variant-validation.json`

- [ ] Start `node tools/model-pipeline/browser/serve.mjs --port <free-port>` and open `/?backend=wasm` in Chromium.
- [ ] Wait for `window.__validationResult.status` to become `passed` and verify the result reports `executionProvider: "wasm"`, model hash `463ba56...72073f2`, four finite FP32 outputs, and ORT Web `1.27.0`.
- [ ] Add the exact result as `fp16Wasm` and regenerate or update the variant report so both browser records have empty `validationErrors`.
- [ ] Run the variant and manifest test suites.

### Task 3: Generate Manifest 1.0.1 Without Mutating 1.0.0

**Files:**
- Modify: `tools/model-pipeline/tests/test_manifest.py`
- Modify: `tools/model-pipeline/ppdoclayout/build_manifest.py`
- Restore: `models/pp-doclayoutv3/1.0.0/manifest.json`
- Create: `models/pp-doclayoutv3/1.0.1/manifest.json`

- [ ] Add failing assertions that generated model version is `1.0.1`, FP16 supports `wasm,webgpu`, FP32 supports `wasm`, and binary URLs still use immutable `v1.0.0-models` assets.
- [ ] Separate `MODEL_VERSION = "1.0.1"` from `ARTIFACT_VERSION = "1.0.0"`; read binaries from the artifact directory and write the default output under the new manifest directory.
- [ ] Make manifest generation require both FP16 browser evidence records.
- [ ] Restore the old manifest compatibility matrix and generate the new manifest.
- [ ] Verify generated JSON exactly matches the checked-in `1.0.1` manifest.

### Task 4: Stage The New Immutable Manifest

**Files:**
- Modify: `scripts/verify-release.test.mjs`
- Modify: `scripts/stage-pages-models.mjs`
- Modify: `scripts/verify-release.mjs`
- Modify: `.github/workflows/model-validation.yml`

- [ ] Add failing staging tests for `/models/v1.0.1`, a `v1.0.1-models` manifest source, reuse of each validated `variant.url`, rejection of unsafe asset URLs, and preservation of both model hashes.
- [ ] Update staging to fetch the manifest from `v1.0.1-models`, validate variant URLs under this repository's immutable model releases, and write `apps/demo/dist/models/v1.0.1`.
- [ ] Update release verification to read manifest `1.0.1`, model binaries from artifact directory `1.0.0`, and require `fp16Wasm.status === "passed"`.
- [ ] Update the model workflow to validate and upload the new manifest release without overwriting `v1.0.0-models`.
- [ ] Run the release contract tests.

### Task 5: Upgrade SDK And Demo

**Files:**
- Modify: `packages/sdk/package.json`
- Modify: `packages/sdk/src/model/manifest.ts`
- Modify: `packages/sdk/src/detector.ts`
- Modify: `packages/sdk/tests/manifest.test.ts`
- Modify: `packages/sdk/tests/detector.test.ts`
- Modify: `packages/sdk/tests/runtime-selector.test.ts`
- Modify: `packages/sdk/etc/web-sdk-pp-doclayoutv3.api.md`
- Modify: `apps/demo/tests/demo.spec.ts`
- Modify: `CHANGELOG.md`

- [ ] Add failing version/default URL expectations for SDK `1.0.5` and model manifest `1.0.1`.
- [ ] Bump the package/runtime version, update the default URL, and add the `1.0.5` changelog entry.
- [ ] Retain the manifest-driven WASM FP16 selection and Demo control tests already added.
- [ ] Build the SDK to regenerate the API report, then run all SDK and Demo tests.

### Task 6: Synchronize Documentation And Verify

**Files:**
- Modify: `README.md`
- Modify: `README.en.md`
- Modify: `packages/sdk/README.md`
- Modify: `docs/en/*.md`
- Modify: `docs/zh-CN/*.md`
- Modify: `models/README.md`
- Modify: `scripts/check-doc-parity.test.mjs`

- [ ] Update default manifest references to `1.0.1`, describe WebGPU FP16 plus WASM FP16/FP32, and keep INT8 explicitly unpublished.
- [ ] Run formatting, bilingual documentation parity, Python model tests, SDK tests/build, Demo tests/build, release contract tests, and `git diff --check`.
- [ ] Request an independent code review and fix every critical or important finding before completion.
