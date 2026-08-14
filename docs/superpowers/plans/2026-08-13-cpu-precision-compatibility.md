# CPU Precision Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make CPU/WASM + FP16 impossible to select and document the validated precision matrix consistently.

**Architecture:** Enforce the model compatibility contract in the SDK selector, then mirror it proactively in the Demo controls. Treat documentation as the public contract and keep Chinese and English pages synchronized.

**Tech Stack:** TypeScript, React, Vitest, Playwright, Markdown

---

### Task 1: SDK selector contract

**Files:**
- Modify: `packages/sdk/src/runtime/select-plan.ts`
- Test: `packages/sdk/tests/runtime-selector.test.ts`

- [ ] Replace the previous CPU/FP16 fallback expectation with a `CAPABILITY_UNSUPPORTED` assertion.
- [ ] Run the focused selector test and confirm it fails because CPU/FP16 currently selects FP32.
- [ ] Add manifest-driven invalid-combination validation before candidate selection, while accepting a validated custom WASM FP16 variant.
- [ ] Re-run the focused selector suite and confirm it passes.

### Task 2: Demo controls and notice

**Files:**
- Modify: `apps/demo/src/App.tsx`
- Modify: `apps/demo/src/i18n/zh-CN.ts`
- Modify: `apps/demo/src/i18n/en.ts`
- Test: `apps/demo/tests/demo.spec.ts`

- [ ] Update the browser test to select FP16 first, switch to CPU, and assert FP32 selection, disabled FP16, and the localized notice.
- [ ] Run the focused browser test and confirm the new assertions fail.
- [ ] Add a backend-selection handler and disabled-state logic without changing automatic mode.
- [ ] Re-run the focused browser test and confirm CPU/FP32 detection completes.

### Task 3: Public documentation

**Files:**
- Modify: `README.md`
- Modify: `README.en.md`
- Modify: `packages/sdk/README.md`
- Modify: `docs/zh-CN/api.md`
- Modify: `docs/en/api.md`
- Modify: `docs/zh-CN/compatibility.md`
- Modify: `docs/en/compatibility.md`
- Modify: `docs/zh-CN/models.md`
- Modify: `docs/en/models.md`
- Modify: `CHANGELOG.md`

- [ ] Add the WebGPU/CPU precision matrix in Chinese and English.
- [ ] Document SDK rejection and Demo prevention for CPU/FP16.
- [ ] Run the documentation parity test and fix any divergence.

### Task 4: Verification

**Files:**
- Verify all files above.

- [ ] Run SDK unit tests, type checking, and linting.
- [ ] Run Demo type checking, linting, and the focused Playwright test.
- [ ] Run `git diff --check` and inspect the final diff for unrelated changes.
