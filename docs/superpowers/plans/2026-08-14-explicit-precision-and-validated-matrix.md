# Explicit Precision and Validated Matrix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure the default model advertises only browser-validated backend/precision pairs and make every manual Demo selection strict instead of silently changing precision or backend.

**Architecture:** The versioned manifest is the SDK source of truth for default runtime candidates. Two small Demo modules isolate support/fallback decisions and runtime error formatting from React, while App renders only combinations valid for the default or custom manifest. Contract tests lock the support matrix across runtime selection, Demo behavior, and bilingual documentation.

**Tech Stack:** TypeScript, React, ONNX Runtime Web, Vitest, Playwright, Node.js test runner, Markdown, JSON

---

### Task 1: Restrict the default manifest to validated browser pairs

**Files:**
- Modify: `packages/sdk/tests/manifest.test.ts`
- Modify: `packages/sdk/tests/runtime-selector.test.ts`
- Modify: `packages/sdk/tests/detector.test.ts`
- Modify: `models/pp-doclayoutv3/1.0.0/manifest.json`

- [ ] **Step 1: Write failing SDK expectations**

In `packages/sdk/tests/manifest.test.ts`, include backend coverage in the existing default manifest assertion:

```ts
    expect(
      manifest.variants.map(({ backendCompatibility, id, precision, url }) => ({
        backendCompatibility,
        id,
        precision,
        url
      }))
    ).toEqual([
      {
        backendCompatibility: ["webgpu"],
        id: "fp16",
        precision: "fp16",
        url: "https://github.com/chenmohan123/web-sdk-PP-DocLayoutV3/releases/download/v1.0.0-models/model-fp16.onnx"
      },
      {
        backendCompatibility: ["wasm"],
        id: "fp32",
        precision: "fp32",
        url: "https://github.com/chenmohan123/web-sdk-PP-DocLayoutV3/releases/download/v1.0.0-models/model-fp32.onnx"
      }
    ]);
```

Rename `skips WebGPU FP16 when shader-f16 is missing` in `packages/sdk/tests/runtime-selector.test.ts` to `uses WASM FP32 when shader-f16 is missing` and change its selected expectation to:

```ts
    expect(plan.selected).toMatchObject({ provider: "wasm", precision: "fp32" });
```

In `packages/sdk/tests/detector.test.ts`, change the automatic fallback runtime expectation to:

```ts
    expect(result.runtime).toMatchObject({ backend: "wasm", precision: "fp32" });
```

- [ ] **Step 2: Run focused SDK tests and verify the red state**

Run:

```powershell
pnpm --filter web-sdk-pp-doclayoutv3 exec vitest run tests/manifest.test.ts tests/runtime-selector.test.ts tests/detector.test.ts
```

Expected: FAIL because the FP32 variant still includes `webgpu` and automatic fallback still selects WebGPU FP32.

- [ ] **Step 3: Correct the default manifest**

Change only the FP32 variant coverage in `models/pp-doclayoutv3/1.0.0/manifest.json`:

```json
"backendCompatibility": [
  "wasm"
]
```

Keep model bytes, filename, SHA-256, URL, validation report, and priority unchanged.

- [ ] **Step 4: Re-run focused SDK tests**

Run the Step 2 command again.

Expected: all manifest, runtime selector, and detector tests pass.

- [ ] **Step 5: Commit the validated matrix**

```powershell
git add -- models/pp-doclayoutv3/1.0.0/manifest.json packages/sdk/tests/manifest.test.ts packages/sdk/tests/runtime-selector.test.ts packages/sdk/tests/detector.test.ts
git commit -m "fix(models): restrict default backend matrix"
```

### Task 2: Make Demo selection strict and expose runtime causes

**Files:**
- Create: `apps/demo/src/execution-preferences.ts`
- Create: `apps/demo/src/runtime-messages.ts`
- Modify: `apps/demo/src/App.tsx`
- Modify: `apps/demo/src/i18n/zh-CN.ts`
- Modify: `apps/demo/src/i18n/en.ts`
- Modify: `apps/demo/tests/demo.spec.ts`

- [ ] **Step 1: Write failing pure-behavior and UI tests**

Add a Playwright test that imports the planned pure modules through Vite:

```ts
test("keeps manual choices strict and uses only validated default pairs", async ({ page }) => {
  await page.goto("/?fixture=1");
  const behavior = await page.evaluate(async ([preferencesUrl, messagesUrl]) => {
    const preferences = await import(preferencesUrl);
    const messages = await import(messagesUrl);
    return {
      autoFallback: preferences.allowFallbackForSelection("auto", "auto"),
      backendFallback: preferences.allowFallbackForSelection("webgpu", "auto"),
      precisionFallback: preferences.allowFallbackForSelection("auto", "fp32"),
      gpuFp16: preferences.supportsCombination("webgpu", "fp16"),
      gpuFp32: preferences.supportsCombination("webgpu", "fp32"),
      wasmFp16: preferences.supportsCombination("wasm", "fp16"),
      wasmFp32: preferences.supportsCombination("wasm", "fp32"),
      gpuCorrection: preferences.precisionForBackend("webgpu", "fp32"),
      wasmCorrection: preferences.precisionForBackend("wasm", "fp16"),
      runtimeError: messages.formatRuntimeError({
        details: { causeMessage: "unsupported WebGPU operator" },
        message: "ONNX session-create failed for webgpu"
      }),
      fallbackCause: messages.formatFallbackCause({
        cause: { message: "adapter allocation failed" },
        message: "ONNX session-create failed for webgpu"
      })
    };
  }, ["/src/execution-preferences.ts", "/src/runtime-messages.ts"]);

  expect(behavior).toEqual({
    autoFallback: true,
    backendFallback: false,
    precisionFallback: false,
    gpuFp16: true,
    gpuFp32: false,
    wasmFp16: false,
    wasmFp32: true,
    gpuCorrection: "fp16",
    wasmCorrection: "fp32",
    runtimeError: "ONNX session-create failed for webgpu: unsupported WebGPU operator",
    fallbackCause: "adapter allocation failed"
  });
});
```

Extend the existing CPU compatibility test into a default matrix interaction test:

```ts
  await precision.getByRole("button", { name: "FP32" }).click();
  await backend.getByRole("button", { name: "GPU" }).click();
  await expect(precision.getByRole("button", { name: "FP32" })).toBeDisabled();
  await expect(precision.getByRole("button", { name: "FP16" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect(page.getByTestId("notice")).toContainText(
    "GPU 默认模型当前仅验证了 FP16，已为你切换模型精度"
  );
```

Retain the existing CPU + FP16 assertions in the same test.

- [ ] **Step 2: Run focused Demo tests and verify the red state**

Run:

```powershell
pnpm --filter demo exec playwright test tests/demo.spec.ts --grep "manual choices strict|validated default model matrix"
```

Expected: FAIL because the pure modules do not exist and GPU FP32 is still enabled.

- [ ] **Step 3: Implement execution preference helpers**

Create `apps/demo/src/execution-preferences.ts`:

```ts
import type { ModelBackend, ModelManifest } from "web-sdk-pp-doclayoutv3";

export type BackendPreference = "auto" | ModelBackend;
export type PrecisionPreference = "auto" | "fp16" | "fp32";

const DEFAULT_SUPPORT = {
  webgpu: ["fp16"],
  wasm: ["fp32"]
} as const;

export function allowFallbackForSelection(
  backend: BackendPreference,
  precision: PrecisionPreference
): boolean {
  return backend === "auto" && precision === "auto";
}

export function supportsCombination(
  backend: ModelBackend,
  precision: Exclude<PrecisionPreference, "auto">,
  manifest?: ModelManifest
): boolean {
  if (manifest === undefined) {
    return (DEFAULT_SUPPORT[backend] as readonly string[]).includes(precision);
  }
  return manifest.variants.some(
    (variant) =>
      variant.precision === precision &&
      variant.backendCompatibility.includes(backend) &&
      variant.validation.included &&
      variant.validation.pass
  );
}

export function precisionForBackend(
  backend: BackendPreference,
  precision: PrecisionPreference,
  manifest?: ModelManifest
): PrecisionPreference {
  if (
    backend === "auto" ||
    precision === "auto" ||
    supportsCombination(backend, precision, manifest)
  ) {
    return precision;
  }
  return (["fp16", "fp32"] as const).find((candidate) =>
    supportsCombination(backend, candidate, manifest)
  ) ?? "auto";
}
```

- [ ] **Step 4: Implement runtime message helpers**

Create `apps/demo/src/runtime-messages.ts`:

```ts
import type { DocLayoutFallback } from "web-sdk-pp-doclayoutv3";

function nestedMessage(value: unknown): string | undefined {
  if (value instanceof Error) return value.message;
  if (typeof value !== "object" || value === null || !("message" in value)) return undefined;
  return typeof value.message === "string" ? value.message : undefined;
}

export function formatRuntimeError(error: unknown): string {
  const message = nestedMessage(error) ?? String(error);
  if (typeof error !== "object" || error === null || !("details" in error)) return message;
  const details = error.details;
  if (typeof details !== "object" || details === null || !("causeMessage" in details)) {
    return message;
  }
  return typeof details.causeMessage === "string" && details.causeMessage !== message
    ? `${message}: ${details.causeMessage}`
    : message;
}

export function formatFallbackCause(
  fallback: Pick<DocLayoutFallback, "cause" | "message">
): string {
  return nestedMessage(fallback.cause) ?? fallback.message;
}
```

- [ ] **Step 5: Connect helpers to App and translations**

In `apps/demo/src/App.tsx`:

- replace local `Backend` and `Precision` aliases with imports of `BackendPreference` and `PrecisionPreference`;
- remove `cpuFp16Supported`;
- make `onBackend` call `precisionForBackend(next, precision, customManifest)` and show `gpuFp32Unsupported` or `cpuFp16Unsupported` when it changes precision;
- pass `allowFallback: allowFallbackForSelection(backend, precision)` to `createDocLayout`;
- use `formatRuntimeError(caught)` in detection and sample error paths;
- disable any non-auto precision button for which `supportsCombination(backend, value, customManifest)` is false;
- render `formatFallbackCause(fallback)` in a second `<small>` below the code and stage.

Add these translation values:

```ts
// zh-CN.ts
gpuFp32Unsupported: "GPU 默认模型当前仅验证了 FP16，已为你切换模型精度。",

// en.ts
gpuFp32Unsupported:
  "The default GPU model is currently validated for FP16 only. Model precision was switched for you.",
```

- [ ] **Step 6: Run focused Demo tests and verify the green state**

Run the Step 2 command again.

Expected: both pure behavior and UI matrix tests pass.

- [ ] **Step 7: Commit strict Demo behavior**

```powershell
git add -- apps/demo/src/App.tsx apps/demo/src/execution-preferences.ts apps/demo/src/runtime-messages.ts apps/demo/src/i18n/zh-CN.ts apps/demo/src/i18n/en.ts apps/demo/tests/demo.spec.ts
git commit -m "fix(demo): honor explicit runtime choices"
```

### Task 3: Synchronize SDK and bilingual documentation

**Files:**
- Modify: `README.md`
- Modify: `README.en.md`
- Modify: `packages/sdk/README.md`
- Modify: `models/README.md`
- Modify: `docs/en/api.md`
- Modify: `docs/en/compatibility.md`
- Modify: `docs/en/conversion.md`
- Modify: `docs/en/models.md`
- Modify: `docs/zh-CN/api.md`
- Modify: `docs/zh-CN/compatibility.md`
- Modify: `docs/zh-CN/conversion.md`
- Modify: `docs/zh-CN/models.md`
- Modify: `scripts/check-doc-parity.test.mjs`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Write a failing documentation matrix contract**

Add a Node test in `scripts/check-doc-parity.test.mjs` that reads the root README, packaged SDK README, model README, and both model documentation files, then requires all of these facts:

```js
assert.match(rootReadme, /WebGPU 仅支持 FP16.*CPU\/WASM 仅支持 FP32/s);
assert.match(packageReadme, /FP16 模型用于 WebGPU；FP32 模型用于 WASM\/CPU/);
assert.match(packageReadme, /The FP16 model targets WebGPU\. The FP32 model targets WASM\/CPU\./);
assert.match(modelReadme, /FP32\s+\| WASM/);
assert.match(englishModels, /FP32\s+\| 143,216,104 bytes \| WASM/);
assert.match(chineseModels, /FP32 \| 143,216,104 字节 \| WASM/);
```

- [ ] **Step 2: Run docs tests and verify the red state**

Run:

```powershell
pnpm docs:test
```

Expected: FAIL because current documents claim WebGPU FP32 support.

- [ ] **Step 3: Update every support statement**

Apply these exact facts consistently:

- Default WebGPU uses the validated FP16 model only.
- Default CPU/WASM uses the validated FP32 model only.
- Fully automatic selection may fall back from WebGPU FP16 to WASM FP32.
- Any manual Demo backend or precision choice is strict and does not silently change at runtime.
- Unsupported default pairs are disabled in the Demo and rejected by the SDK if requested directly.
- Custom manifests may enable WebGPU FP32 or WASM FP16 only when they declare an included, passing compatible variant.
- FP32 parity validation and browser WASM execution passed; physical WebGPU FP32 validation has not been recorded.

Add an `Unreleased` Changelog bullet:

```markdown
- Corrected the validated default backend matrix to WebGPU FP16 and WASM FP32, made manual Demo selections strict, and exposed detailed runtime fallback causes.
```

- [ ] **Step 4: Run docs and release contracts**

Run:

```powershell
pnpm docs:test
pnpm release:test
```

Expected: both contract suites pass.

- [ ] **Step 5: Commit synchronized documentation**

```powershell
git add -- README.md README.en.md packages/sdk/README.md models/README.md docs/en/api.md docs/en/compatibility.md docs/en/conversion.md docs/en/models.md docs/zh-CN/api.md docs/zh-CN/compatibility.md docs/zh-CN/conversion.md docs/zh-CN/models.md scripts/check-doc-parity.test.mjs CHANGELOG.md docs/superpowers/plans/2026-08-14-explicit-precision-and-validated-matrix.md
git commit -m "docs: align validated backend precision support"
```

### Task 4: Verify the complete change

**Files:**
- Verify all files modified in Tasks 1-3

- [ ] **Step 1: Run static quality gates**

```powershell
pnpm exec prettier --check .github apps/demo/src apps/demo/tests packages/sdk/src packages/sdk/tests models README.md README.en.md packages/sdk/README.md docs scripts CHANGELOG.md
pnpm lint
pnpm typecheck
git diff --check
```

Expected: all commands exit zero with no formatting, lint, type, or whitespace failures.

- [ ] **Step 2: Run tests and production builds**

```powershell
pnpm docs:test
pnpm release:test
pnpm --filter web-sdk-pp-doclayoutv3 test
pnpm --filter demo test
pnpm build
```

Expected: all suites and builds pass. Demo tests must include the strict manual selection and validated matrix regressions.

- [ ] **Step 3: Verify the Demo visually at desktop and mobile widths**

Start the Demo on an unused local port and verify with browser automation at 1440x900 and 390x844:

- GPU mode disables FP32 and keeps FP16 selected.
- CPU mode disables FP16 and keeps FP32 selected.
- notices fit without overlap;
- no horizontal overflow occurs;
- fallback cause text wraps inside the details panel.

- [ ] **Step 4: Review final diff and repository state**

```powershell
git status --short --branch
git diff origin/develop...HEAD --stat
git diff origin/develop...HEAD --check
```

Expected: only the approved manifest, Demo, SDK tests, documentation, Changelog, design, and plan changes are present.
