# PP-DocLayoutV3 Web SDK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build, validate, document, and publicly release a browser-first PP-DocLayoutV3 SDK with automatic WebGPU/WASM execution and versioned ONNX model assets.

**Architecture:** A framework-independent TypeScript SDK loads a versioned model manifest, chooses a validated ONNX variant, caches and verifies it, then runs preprocessing, ONNX Runtime Web inference, and postprocessing. A separate reproducible Python pipeline exports and validates FP32/FP16/INT8 assets; a React demo and small framework examples consume only the public SDK API.

**Tech Stack:** TypeScript, pnpm workspaces, tsup, Vitest, Playwright, ONNX Runtime Web, React/Vite, Python 3.11, PyTorch/Transformers, ONNX/ONNX Runtime, Git LFS, GitHub Actions, GitHub Pages, npm provenance.

---

## File Map

The implementation lives in `F:\git\00_chenmohan\github\web-sdk-PP-DocLayoutV3` after Task 1.

```text
.
├─ apps/demo/                         React/Vite public demo
├─ examples/
│  ├─ cdn/                            Script-tag example
│  ├─ vanilla-vite/                   Framework-free bundler example
│  ├─ react/                          React integration example
│  ├─ vue/                            Vue integration example
│  └─ wechat-webview/                 Official-account and mini-program WebView guide/example
├─ packages/sdk/
│  ├─ src/
│  │  ├─ cache/                       Large model cache adapters
│  │  ├─ image/                       Browser image decoding
│  │  ├─ model/                       Manifest parsing, selection, download, integrity
│  │  ├─ runtime/                     Capability probing and ORT session management
│  │  ├─ worker/                      Optional inference worker and bridge
│  │  ├─ detector.ts                  Public orchestration
│  │  ├─ errors.ts                    Stable error codes
│  │  ├─ index.ts                     Public exports
│  │  ├─ postprocess.ts               PP-DocLayoutV3 output decoding
│  │  ├─ preprocess.ts                800x800 tensor creation
│  │  └─ types.ts                     Public contracts
│  └─ tests/                          Unit and integration tests
├─ models/
│  ├─ pp-doclayoutv3/1.0.0/manifest.json
│  └─ pp-doclayoutv3/1.0.0/*.onnx     Git LFS objects
├─ tools/model-pipeline/
│  ├─ ppdoclayout/                    Python conversion library
│  ├─ tests/                          Conversion and parity tests
│  ├─ fixtures/                       Licensed validation images and expected output
│  └─ requirements-model.in           Resolver input; lock generated in Task 3
├─ tests/browser/                     Playwright SDK/package tests
├─ docs/zh-CN/                        Primary documentation
├─ docs/en/                           English documentation
└─ .github/workflows/                 CI, Pages, model, and release workflows
```

## Phase A: Repository and Reproducible Model Assets

### Task 1: Create the Public Repository and Canonical Clone

**Files:**
- Existing: `docs/superpowers/specs/2026-08-11-web-sdk-pp-doclayoutv3-design.md`
- Existing: `docs/superpowers/plans/2026-08-11-web-sdk-pp-doclayoutv3.md`

- [ ] **Step 1: Verify authenticated identities and name availability**

Run outside the network sandbox:

```powershell
gh auth status
npm whoami
gh repo view chenmohan123/web-sdk-PP-DocLayoutV3 --json name,url,visibility
npm view web-sdk-pp-doclayoutv3 name --json
```

Expected: GitHub and npm report the intended user. A missing GitHub repository and npm `E404` mean the preferred names are available. If the npm name exists, use `@chenmohan123/pp-doclayout-v3` for all later package metadata.

- [ ] **Step 2: Create and push the public repository**

From the current design repository:

```powershell
gh repo create chenmohan123/web-sdk-PP-DocLayoutV3 --public --source . --remote origin --push
git branch main develop
git push -u origin main
gh repo edit chenmohan123/web-sdk-PP-DocLayoutV3 --default-branch main
```

Expected: public repository exists; `main` and `develop` both point to the approved design history; GitHub default branch is `main`.

- [ ] **Step 3: Clone to the canonical local path**

```powershell
New-Item -ItemType Directory -Force -Path 'F:\git\00_chenmohan\github' | Out-Null
git clone --branch develop https://github.com/chenmohan123/web-sdk-PP-DocLayoutV3.git 'F:\git\00_chenmohan\github\web-sdk-PP-DocLayoutV3'
git -C 'F:\git\00_chenmohan\github\web-sdk-PP-DocLayoutV3' status --short --branch
```

Expected: clean `develop` checkout. All later commands use this clone.

### Task 2: Scaffold the Workspace and Quality Gates

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `eslint.config.mjs`
- Create: `.prettierrc.json`
- Create: `.nvmrc`
- Create: `LICENSE`
- Create: `packages/sdk/package.json`
- Create: `packages/sdk/tsconfig.json`
- Create: `packages/sdk/src/index.ts`
- Create: `packages/sdk/tests/package-smoke.test.ts`

- [ ] **Step 1: Write the package smoke test before the package exists**

```ts
// packages/sdk/tests/package-smoke.test.ts
import { describe, expect, it } from "vitest";
import * as sdk from "../src/index";

describe("public package", () => {
  it("exports the factory and error type", () => {
    expect(sdk).toHaveProperty("createDocLayout");
    expect(sdk).toHaveProperty("DocLayoutError");
  });
});
```

- [ ] **Step 2: Add workspace metadata and scripts**

Use `pnpm@11.16.0`, Node `24`, TypeScript strict mode, ESLint flat config, Prettier, Vitest, tsup, and Playwright. Root scripts must be exactly `format:check`, `lint`, `typecheck`, `test`, `build`, `test:browser`, `model:test`, and `verify` where `verify` runs all checks that do not require a GPU or full model download. Add the full Apache License 2.0 text as `LICENSE`, and use the npm name selected in Task 1 in `packages/sdk/package.json`.

- [ ] **Step 3: Run the smoke test and observe the expected failure**

Run: `pnpm --filter ./packages/sdk test -- package-smoke.test.ts`

Expected: FAIL because `createDocLayout` and `DocLayoutError` are not exported.

- [ ] **Step 4: Add compile-safe temporary exports**

```ts
// packages/sdk/src/index.ts
export class DocLayoutError extends Error {}

export async function createDocLayout(): Promise<never> {
  throw new DocLayoutError("SDK implementation is not initialized");
}
```

- [ ] **Step 5: Verify the workspace and commit**

Run: `pnpm install`, then `pnpm verify`.

Expected: lint, types, unit tests, and builds pass.

Commit: `chore: scaffold SDK workspace`

### Task 3: Characterize the Official Model Contract

**Files:**
- Create: `tools/model-pipeline/requirements-model.in`
- Create: `tools/model-pipeline/ppdoclayout/inspect_model.py`
- Create: `tools/model-pipeline/tests/test_inspect_model.py`
- Create: `tools/model-pipeline/artifacts/model-contract.json`
- Create: `tools/model-pipeline/requirements-model.lock`

- [ ] **Step 1: Create and lock the isolated Python environment**

`requirements-model.in` must list `torch`, `transformers`, `safetensors`, `onnx`, `onnxruntime`, `onnxscript`, `onnxconverter-common`, `numpy`, `pillow`, `pyyaml`, and `pytest`. Resolve these in `.venv-model` and generate `requirements-model.lock` with exact versions using `pip freeze`; commit the lock.

- [ ] **Step 2: Write a failing contract inspection test**

```py
def test_contract_contains_required_outputs(model_contract):
    assert model_contract["input"]["name"] == "pixel_values"
    assert model_contract["input"]["shape"] == [1, 3, 800, 800]
    assert {"logits", "out_masks", "order_logits", "pred_boxes"} <= set(model_contract["outputs"])
    assert model_contract["parameterCount"] > 0
    assert len(model_contract["labels"]) == 25
```

- [ ] **Step 3: Implement the inspector**

The inspector loads `E:\models\PP-DocLayoutV3_safetensors` with `AutoModelForObjectDetection` and `AutoImageProcessor`, performs one no-grad forward pass on a deterministic `1x3x800x800` tensor, enumerates `outputs.keys()`, shapes, dtypes, parameter count, label mapping, processor values, installed package versions, and source file SHA-256 values, then writes sorted JSON.

- [ ] **Step 4: Run and review the contract**

Run: `python -m ppdoclayout.inspect_model --model E:\models\PP-DocLayoutV3_safetensors --output artifacts/model-contract.json`

Expected: required outputs are present and every output shape is concrete for batch size 1. If the installed released Transformers version cannot load the architecture, pin the first upstream commit that can, record its commit SHA in the lock metadata, and rerun.

- [ ] **Step 5: Commit the probe and contract**

Commit: `build(model): record official model contract`

### Task 4: Export and Validate the FP32 ONNX Graph

**Files:**
- Create: `tools/model-pipeline/ppdoclayout/export_fp32.py`
- Create: `tools/model-pipeline/ppdoclayout/export_wrapper.py`
- Create: `tools/model-pipeline/ppdoclayout/onnx_checks.py`
- Create: `tools/model-pipeline/tests/test_export_fp32.py`
- Create: `models/pp-doclayoutv3/1.0.0/model-fp32.onnx`
- Create: `.gitattributes`

- [ ] **Step 1: Write the failing exporter test**

```py
def test_fp32_graph_has_browser_contract(exported_model):
    graph = load_and_check(exported_model)
    assert graph.input_names == ["pixel_values"]
    assert graph.output_names == ["logits", "pred_boxes", "order_logits", "out_masks"]
    assert graph.input_shape("pixel_values") == [1, 3, 800, 800]
    assert graph.external_data_files == []
```

- [ ] **Step 2: Implement a stable export wrapper**

```py
class PPDocLayoutExportWrapper(torch.nn.Module):
    output_names = ("logits", "pred_boxes", "order_logits", "out_masks")

    def __init__(self, model):
        super().__init__()
        self.model = model

    def forward(self, pixel_values):
        out = self.model(pixel_values=pixel_values)
        return tuple(getattr(out, name) for name in self.output_names)
```

Export a fixed batch and image shape with the lowest opset supported by all required operators and ONNX Runtime Web. Run `onnx.checker.check_model`, shape inference, and an ONNX Runtime CPU smoke inference immediately after export.

- [ ] **Step 3: Verify deterministic graph metadata**

Run the exporter twice into separate temporary paths. Expected: identical output names, shapes, opset, initializer names, parameter count, and inference results. Record SHA-256; byte-for-byte identity is preferred but not required when protobuf ordering differs.

- [ ] **Step 4: Track large models with Git LFS**

Run: `git lfs track "models/**/*.onnx"` and verify `git check-attr filter -- models/pp-doclayoutv3/1.0.0/model-fp32.onnx` returns `lfs`.

- [ ] **Step 5: Commit**

Commit: `build(model): export FP32 ONNX model`

### Task 5: Build the Official-vs-ONNX Parity Harness

**Files:**
- Create: `tools/model-pipeline/ppdoclayout/postprocess_reference.py`
- Create: `tools/model-pipeline/ppdoclayout/validate.py`
- Create: `tools/model-pipeline/fixtures/fixtures.lock.json`
- Create: `tools/model-pipeline/fixtures/images/*`
- Create: `tools/model-pipeline/tests/test_parity_fp32.py`
- Create: `tools/model-pipeline/reports/fp32-validation.json`

- [ ] **Step 1: Add licensed validation fixtures**

Include the official layout demo plus a small, documented set covering Chinese, English, table, formula, image, skew, curve, and screen photo. `fixtures.lock.json` records source URL, license, local filename, SHA-256, width, and height. Do not commit an image without attribution.

- [ ] **Step 2: Write failing parity assertions**

For detections at threshold `0.5`, require FP32 ONNX to match the official implementation with identical labels and reading order, maximum score delta `0.001`, box coordinate delta at most `1.0` original-image pixel, and polygon coordinate delta at most `1.5` pixels.

- [ ] **Step 3: Implement one shared comparison report**

The report contains source hashes, environment versions, per-output max/mean absolute error, matched/unmatched detections, coordinate deltas, and an overall pass boolean. Exit code is nonzero when any FP32 threshold fails.

- [ ] **Step 4: Run both local official implementations where possible**

Compare Transformers vs ONNX for every fixture. Also run the Paddle model from `E:\models\PP-DocLayoutV3` on the same images when its official runtime supports the current Python/Windows environment; record Paddle as an additional reference, not as a blocker when its runtime cannot be installed.

- [ ] **Step 5: Commit**

Commit: `test(model): validate FP32 parity`

### Task 6: Produce Conditional FP16 and INT8 Variants

**Files:**
- Create: `tools/model-pipeline/ppdoclayout/convert_fp16.py`
- Create: `tools/model-pipeline/ppdoclayout/quantize_int8.py`
- Create: `tools/model-pipeline/tests/test_variants.py`
- Create: `models/pp-doclayoutv3/1.0.0/model-fp16.onnx`
- Conditionally create: `models/pp-doclayoutv3/1.0.0/model-int8.onnx`
- Create: `tools/model-pipeline/reports/variant-validation.json`

- [ ] **Step 1: Write variant acceptance tests**

FP16 must achieve at least 99% matched detections at label equality and IoU `0.95`, maximum score delta `0.02`, and mean polygon point distance at most `2` pixels. INT8 must achieve at least 97% matches at IoU `0.90`, maximum score delta `0.05`, and mean polygon distance at most `4` pixels; it must also be at most 60% of FP32 size or improve median WASM inference by at least 10%.

- [ ] **Step 2: Convert FP16 with supported-op safeguards**

Use `onnxconverter_common.float16.convert_float_to_float16` with FP32 input/output types preserved. Block only operators proven incompatible by ONNX Runtime Web smoke tests, and store the block list in the report.

- [ ] **Step 3: Quantize INT8 with calibration**

Use ONNX Runtime static QDQ quantization and the validation images as calibration data. Try per-channel signed weights and unsigned activations first; if the browser WASM build rejects the graph, record the failure and exclude INT8 rather than changing the manifest to an unverified model.

- [ ] **Step 4: Run CPU and real-browser validation**

Run Python ONNX Runtime parity first, then load each model with the exact `onnxruntime-web` version in Chromium. FP16 must additionally execute through WebGPU on a real adapter.

- [ ] **Step 5: Commit accepted artifacts and the complete report**

Commit: `build(model): add validated optimized variants`

### Task 7: Generate the Versioned Model Manifest

**Files:**
- Create: `tools/model-pipeline/ppdoclayout/build_manifest.py`
- Create: `tools/model-pipeline/tests/test_manifest.py`
- Create: `models/pp-doclayoutv3/1.0.0/manifest.json`
- Create: `models/README.md`
- Create: `THIRD_PARTY_NOTICES.md`

- [ ] **Step 1: Write schema and integrity tests**

Assert schema version `1`, 25 labels, fixed input shape, actual output names, sorted variants, exact byte sizes, SHA-256 values, validation status, source license, source hashes, opset, and SDK minimum version. An INT8 entry is forbidden when its validation report is not passing.

- [ ] **Step 2: Generate, never hand-edit, the manifest**

`build_manifest.py` reads the contract and validation reports, inspects ONNX files, and writes canonical sorted JSON. Release URLs are version-specific and use `download/v1.0.0-models/`; no `latest` URL is allowed.

- [ ] **Step 3: Verify reproducibility and notices**

Run generation twice and require no git diff on the second run. Verify Apache-2.0 attribution and the paper citation are present.

- [ ] **Step 4: Commit**

Commit: `build(model): add versioned model manifest`

## Phase B: SDK Runtime

### Task 8: Define Public Types, Errors, and Manifest Validation

**Files:**
- Create: `packages/sdk/src/types.ts`
- Create: `packages/sdk/src/errors.ts`
- Create: `packages/sdk/src/model/manifest.ts`
- Create: `packages/sdk/tests/manifest.test.ts`
- Modify: `packages/sdk/src/index.ts`

- [ ] **Step 1: Write failing contract tests**

Test valid default manifest parsing, unknown schema rejection, missing output rejection, SHA format rejection, duplicate precision/backend rejection, SDK minimum-version rejection, and serialization of `DocLayoutError` fields.

- [ ] **Step 2: Define the stable error contract**

```ts
export type DocLayoutErrorCode =
  | "CAPABILITY_UNSUPPORTED" | "MANIFEST_INVALID" | "MODEL_INCOMPATIBLE"
  | "MODEL_DOWNLOAD_FAILED" | "MODEL_INTEGRITY_FAILED" | "IMAGE_INVALID"
  | "SESSION_CREATE_FAILED" | "INFERENCE_FAILED" | "OUT_OF_MEMORY" | "ABORTED";

export class DocLayoutError extends Error {
  constructor(
    public readonly code: DocLayoutErrorCode,
    message: string,
    public readonly details: Readonly<Record<string, unknown>> = {},
    options?: ErrorOptions
  ) { super(message, options); this.name = "DocLayoutError"; }
}
```

- [ ] **Step 3: Implement the manifest parser without implicit defaults for model semantics**

Defaults are allowed for SDK behavior such as cache and fallback, but input/output names, shapes, labels, preprocessing, precision, hash, and model URLs must come from a validated manifest.

- [ ] **Step 4: Run and commit**

Run: `pnpm --filter ./packages/sdk test -- manifest.test.ts`

Expected: PASS.

Commit: `feat(sdk): define model and error contracts`

### Task 9: Implement Runtime Capability Selection

**Files:**
- Create: `packages/sdk/src/runtime/capabilities.ts`
- Create: `packages/sdk/src/runtime/select-plan.ts`
- Create: `packages/sdk/tests/runtime-selector.test.ts`

- [ ] **Step 1: Write table-driven failing tests**

Cover the exact order `WebGPU FP16 -> WebGPU FP32 -> WASM INT8 -> WASM FP32`, missing `shader-f16`, absent INT8, explicit WebGPU without fallback, explicit precision with fallback, no WebGPU, and abort during adapter request.

- [ ] **Step 2: Implement injected capability probing**

`probeCapabilities(environment)` returns booleans and diagnostic strings for WebGPU, FP16, WASM, SIMD, threads, cross-origin isolation, and worker support. Tests inject a fake environment; production reads globals only inside the probe function.

- [ ] **Step 3: Implement the pure selection function**

`selectExecutionPlan(options, capabilities, variants)` is deterministic and has no network or ORT calls. Each candidate includes provider, precision, variant ID, and the reason it was selected or skipped.

- [ ] **Step 4: Verify and commit**

Commit: `feat(sdk): select WebGPU and WASM execution plans`

### Task 10: Implement Download, Integrity, and Cache Management

**Files:**
- Create: `packages/sdk/src/model/download.ts`
- Create: `packages/sdk/src/model/integrity.ts`
- Create: `packages/sdk/src/cache/model-cache.ts`
- Create: `packages/sdk/src/cache/cache-storage.ts`
- Create: `packages/sdk/src/cache/memory-cache.ts`
- Create: `packages/sdk/src/model/model-manager.ts`
- Create: `packages/sdk/tests/model-manager.test.ts`

- [ ] **Step 1: Write failing tests with fake fetch and cache adapters**

Test cold download progress, warm cache hit with zero download bytes, SHA mismatch eviction, unknown content length, abort, HTTP/CORS-like failure, Cache Storage quota failure with memory fallback, and cache clear/list behavior.

- [ ] **Step 2: Implement streaming download**

Read `Response.body` chunks, publish monotonically increasing progress, combine once, compute SHA-256 with `crypto.subtle`, and reject before session creation on mismatch. Preserve the original cause in `DocLayoutError`.

- [ ] **Step 3: Implement cache keys and adapters**

The key is `ppdoclayout:<model-name>:<version>:<variant-id>:<sha256>`. Cache entries whose hash does not match the current manifest are never reused.

- [ ] **Step 4: Verify and commit**

Commit: `feat(sdk): download and cache verified model assets`

### Task 11: Implement Image Decoding and Preprocessing

**Files:**
- Create: `packages/sdk/src/image/decode.ts`
- Create: `packages/sdk/src/preprocess.ts`
- Create: `packages/sdk/tests/preprocess.test.ts`
- Create: `packages/sdk/tests/fixtures/preprocess-reference.json`

- [ ] **Step 1: Generate a Python reference fixture**

Use a deterministic 3x2 RGB image with six distinct pixels and the official image processor to record resize behavior, channel order, scale, tensor shape, and representative tensor values.

- [ ] **Step 2: Write failing preprocessing tests**

Assert `Float32Array`, shape `[1,3,800,800]`, RGB-to-NCHW order, `1/255` scaling, interpolation parity at sampled pixels, original dimensions, resource cleanup, invalid zero-size rejection, and abort.

- [ ] **Step 3: Implement decoding with one normalized raster boundary**

All DOM inputs become `{ width, height, rgba: Uint8ClampedArray }`. Use `createImageBitmap` and `OffscreenCanvas` when supported, with HTML canvas fallback. Close internally created `ImageBitmap` objects in `finally`.

- [ ] **Step 4: Verify and commit**

Commit: `feat(sdk): decode and preprocess document images`

### Task 12: Implement PP-DocLayoutV3 Postprocessing

**Files:**
- Create: `packages/sdk/src/postprocess.ts`
- Create: `packages/sdk/tests/postprocess.test.ts`
- Create: `packages/sdk/tests/fixtures/model-output-reference.json`

- [ ] **Step 1: Export a compact official reference output**

Store logits, boxes, order logits, masks, original size, threshold, and expected official postprocessed detections for a deliberately small synthetic output plus one real-image output. The fixture records the sigmoid/top-k behavior, reading-order sort, mask-to-polygon algorithm, and exact polygon normalization.

- [ ] **Step 2: Write failing tests**

Test stable sigmoid and global top-k selection across all classes, threshold boundary, center-box conversion, non-square coordinate scaling, polygon scaling, clipping rules matching the official processor, duplicated label names with distinct IDs, and reading order preservation. PP-DocLayoutV3 has no background exclusion in the official processor.

- [ ] **Step 3: Implement only the evidenced official algorithm**

Use typed arrays and avoid per-query temporary arrays in hot loops. Do not add NMS unless the official PP-DocLayoutV3 processor applies it.

- [ ] **Step 4: Verify against Python fixtures and commit**

Commit: `feat(sdk): decode layout detections and reading order`

### Task 13: Implement ORT Sessions and Worker Execution

**Files:**
- Create: `packages/sdk/src/runtime/ort-session.ts`
- Create: `packages/sdk/src/worker/protocol.ts`
- Create: `packages/sdk/src/worker/inference.worker.ts`
- Create: `packages/sdk/src/worker/worker-bridge.ts`
- Create: `packages/sdk/tests/ort-session.test.ts`
- Create: `packages/sdk/tests/worker-bridge.test.ts`

- [ ] **Step 1: Write failing session lifecycle tests**

Using an injected fake ORT module, test provider option mapping, WASM thread selection, session-create timing, tensor disposal, session release, idempotent dispose, execution failure mapping, out-of-memory mapping, and explicit-mode no-fallback behavior.

- [ ] **Step 2: Write failing worker protocol tests**

Test request IDs, transferable ArrayBuffers, progress events, abort, worker crash, late response after dispose, and main-thread fallback when Worker or OffscreenCanvas is unavailable.

- [ ] **Step 3: Implement the session wrapper and worker bridge**

The worker accepts structured-cloneable manifests, model bytes, normalized raster data, and detect options. WebGPU is used in a worker only after a real capability probe there; otherwise the selected plan may execute on the main thread while maintaining the same async API.

- [ ] **Step 4: Verify and commit**

Commit: `feat(sdk): run ONNX sessions with worker support`

### Task 14: Implement the Public Detector Orchestrator

**Files:**
- Create: `packages/sdk/src/detector.ts`
- Create: `packages/sdk/tests/detector.test.ts`
- Modify: `packages/sdk/src/index.ts`

- [ ] **Step 1: Write end-to-end failing tests with injected dependencies**

Test zero-config default manifest, custom manifest URL, `{ manifest, data }`, automatic candidate fallback with a recorded cause, explicit no-fallback, load progress order, complete timing fields, concurrent detect serialization or rejection as documented, abort, cache methods, and post-dispose rejection.

- [ ] **Step 2: Implement the public API**

Export `createDocLayout`, `DocLayoutDetector`, manifest/result/options types, `DocLayoutError`, `probeDocLayoutCapabilities`, and cache helpers. Keep internal ORT and cache adapters injectable through a non-public test seam rather than public configuration.

- [ ] **Step 3: Verify public API extraction**

Generate declarations and run API Extractor or an equivalent checked API report so accidental public surface changes fail CI.

- [ ] **Step 4: Commit**

Commit: `feat(sdk): expose PP-DocLayoutV3 detector API`

### Task 15: Build and Browser-Test the Published Package

**Files:**
- Create: `packages/sdk/tsup.config.ts`
- Create: `packages/sdk/src/browser-global.ts`
- Create: `tests/browser/package.spec.ts`
- Create: `tests/browser/tiny-model.ts`
- Create: `playwright.config.ts`
- Modify: `packages/sdk/package.json`

- [ ] **Step 1: Write failing package export tests**

Pack the SDK, install it into a temporary Vite fixture, and test ESM import, TypeScript declarations, browser global `PPDocLayout`, worker asset resolution, and absence of `.onnx` files in the npm tarball.

- [ ] **Step 2: Configure production builds**

Externalize or correctly split `onnxruntime-web` as documented for ESM while producing a self-consistent browser-global build. Pin the ORT WASM asset strategy and expose an option to override its base URL.

- [ ] **Step 3: Run browser smoke tests**

Use a tiny deterministic ONNX model for CI lifecycle tests, then run a tagged local suite against the real PP-DocLayoutV3 assets. Verify nonblank output, detection overlay coordinates, WASM, WebGPU when available, and model cache behavior.

- [ ] **Step 4: Commit**

Commit: `build(sdk): publish ESM and browser distributions`

## Phase C: Demo, Documentation, and Release

### Task 16: Build the Responsive Bilingual Demo

**Files:**
- Create: `apps/demo/package.json`
- Create: `apps/demo/src/App.tsx`
- Create: `apps/demo/src/components/*`
- Create: `apps/demo/src/i18n/zh-CN.ts`
- Create: `apps/demo/src/i18n/en.ts`
- Create: `apps/demo/src/styles.css`
- Create: `apps/demo/tests/demo.spec.ts`

- [ ] **Step 1: Write Playwright user-flow tests first**

Test Chinese default, English switch, backend and precision controls, model progress, cancellation, one-image selection, result overlay, polygon/box toggle, threshold, timings, model metadata, fallback detail, JSON export, cache clear, custom manifest validation, and mobile stacking without overlap.

- [ ] **Step 2: Implement the approved information architecture**

Use a compact top control band, large result canvas, and right-side metrics/details panel; mobile order is controls, image, detections, then performance/model information. Use Lucide icons for icon actions, segmented controls for backend/precision, and no explanatory marketing hero.

- [ ] **Step 3: Add real rendering and canvas checks**

Overlay original-image-coordinate boxes and polygons on a canvas that tracks CSS and bitmap dimensions separately. Playwright asserts the canvas contains non-background pixels and screenshots desktop, narrow mobile, and wide desktop viewports.

- [ ] **Step 4: Verify and commit**

Run: `pnpm --filter demo test` and `pnpm --filter demo build`.

Commit: `feat(demo): add responsive layout detection demo`

### Task 17: Add Consumer Examples

**Files:**
- Create: `examples/cdn/index.html`
- Create: `examples/vanilla-vite/*`
- Create: `examples/react/*`
- Create: `examples/vue/*`
- Create: `examples/wechat-webview/*`
- Create: `examples/tests/examples.test.ts`

- [ ] **Step 1: Add failing build and content tests**

Every example must install from the packed local SDK, build without workspace-only aliases, reference only public API, and include a model loading/error state. The WeChat example must say it runs inside H5/WebView and does not claim native mini-program inference.

- [ ] **Step 2: Implement minimal focused examples**

Each example performs the same flow: create detector, show progress, select one image, render JSON or an overlay, handle a structured error, and dispose. CDN example uses `window.PPDocLayout`; React and Vue dispose on component unmount.

- [ ] **Step 3: Verify and commit**

Commit: `docs(examples): add browser integration examples`

### Task 18: Write Chinese-First Bilingual Documentation

**Files:**
- Create: `README.md`
- Create: `README.en.md`
- Create: `docs/zh-CN/*.md`
- Create: `docs/en/*.md`
- Create: `docs/error-codes.json`
- Create: `scripts/check-doc-parity.mjs`

- [ ] **Step 1: Define and test the documentation inventory**

`check-doc-parity.mjs` requires matching slugs for quick start, API, compatibility, models, conversion, custom models, deployment, performance, errors, and troubleshooting. It also checks reciprocal language links, code sample compilation, and absence of unsupported native mini-program claims.

- [ ] **Step 2: Write Chinese documentation, then English equivalents**

README Chinese is the default landing page. Both languages document zero-config use, manual backend/precision, auto fallback, custom manifest with `{ manifest, data }`, CORS/cache/COOP/COEP, model size, privacy, model license/source, and real benchmark environment.

- [ ] **Step 3: Generate error-code tables from one JSON source**

Keep runtime error messages in English; provide bilingual explanations and remedies generated from `docs/error-codes.json` so codes cannot drift.

- [ ] **Step 4: Verify and commit**

Commit: `docs: add Chinese and English SDK guides`

### Task 19: Add CI, Pages, Model Release, and npm Release Workflows

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/pages.yml`
- Create: `.github/workflows/model-validation.yml`
- Create: `.github/workflows/release.yml`
- Create: `.github/dependabot.yml`
- Create: `.github/ISSUE_TEMPLATE/bug_report.yml`
- Create: `.github/ISSUE_TEMPLATE/feature_request.yml`
- Create: `.github/pull_request_template.md`
- Create: `scripts/verify-release.mjs`

- [ ] **Step 1: Add local workflow contract tests**

`verify-release.mjs` asserts pinned action major versions, least-privilege permissions, Node/pnpm versions, `pnpm verify`, packed-package smoke test, Pages base path, tag/package version agreement, provenance flag, model SHA checks, and no publish job on `develop`.

- [ ] **Step 2: Implement CI and Pages**

CI runs on PRs and pushes to `develop`/`main`. Pages builds the Demo with repository base path and deploys only from `main`. Browser CI guarantees WASM; WebGPU is an explicitly tagged hardware job or local report, never silently software-backed.

- [ ] **Step 3: Implement model and npm release workflows**

Model workflow is manual and verifies reports before uploading assets. npm release requires a `v*` tag on `main`, checks package/version/tag consistency, uses Trusted Publishing when configured or `NPM_TOKEN`, runs `npm publish --access public --provenance`, and records the resulting integrity. Structured bug and feature templates collect browser, device, selected backend/precision, SDK/model versions, and sanitized diagnostics without requesting document images by default.

- [ ] **Step 4: Verify with actionlint and commit**

Commit: `ci: add validation pages and release workflows`

### Task 20: Perform Full Verification and Publish 1.0.0

**Files:**
- Create: `benchmarks/1.0.0/*.json`
- Create: `benchmarks/1.0.0/README.md`
- Modify: `CHANGELOG.md`
- Modify: package version and model release URLs as required

- [ ] **Step 1: Run the complete clean verification**

```powershell
pnpm install --frozen-lockfile
pnpm verify
pnpm test:browser
pnpm --filter demo build
pnpm pack --filter ./packages/sdk
```

Expected: all checks pass and tarball contains no ONNX model.

- [ ] **Step 2: Run real-model CPU and GPU benchmarks**

Record browser version, OS, CPU, GPU/adapter, ORT version, SDK commit, model hash, cold download, warm load, preprocessing, inference, postprocessing, total time, peak memory where observable, and detection parity. Test WASM FP32, accepted WASM INT8, WebGPU FP32, and accepted WebGPU FP16.

- [ ] **Step 3: Verify responsive visual output**

Capture Playwright screenshots at 390x844, 768x1024, 1440x900, and 1920x1080. Assert no overlap, no clipped controls, nonblank result canvas, correct overlay alignment, and visible next content on small screens.

- [ ] **Step 4: Release model assets**

Create `v1.0.0-models`, upload manifest, accepted ONNX variants, SHA-256 file, validation reports, and benchmark summary. Fetch every release URL and verify size/hash before changing the default manifest URL.

- [ ] **Step 5: Merge and publish SDK**

Merge `develop` to `main` through a reviewed PR, tag `v1.0.0`, run the release workflow, and verify:

```powershell
npm view web-sdk-pp-doclayoutv3 version dist.integrity --json
npm install web-sdk-pp-doclayoutv3@1.0.0
gh release view v1.0.0
```

Use `@chenmohan123/pp-doclayout-v3` in these commands if Task 1 selected the scoped fallback.

- [ ] **Step 6: Verify public endpoints and announce support boundaries**

Open GitHub Pages on desktop and mobile, run one detection through WebGPU and WASM, verify Chinese default and English switch, and confirm README links, npm package, source tags, model release, license, and issue templates are public.

- [ ] **Step 7: Commit final release metadata**

Commit: `chore: release 1.0.0`

## Execution Checkpoints

- After Task 3: review the observed model contract before writing export assumptions.
- After Task 5: review FP32 parity; do not continue to SDK postprocessing if parity fails.
- After Task 7: review model manifest and accepted variants.
- After Task 15: review packed SDK and real-model browser smoke test.
- After Task 16: review desktop/mobile screenshots and interaction flow.
- Before Task 20: review release candidate, benchmark report, npm tarball, and public support claims.
