# Demo Samples And Load Timings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add verified local document samples to the Demo and expose separate model acquisition timing fields.

**Architecture:** Extend the SDK's `LoadedModel` result with additive timing/source metadata measured inside `ModelManager`, propagate it through detector load timings, and render it in the existing Demo details panel. Add a small static sample catalog that reuses the existing image-selection flow.

**Tech Stack:** TypeScript, React, Vite, Vitest, Playwright, ONNX Runtime Web.

---

### Task 1: Extend SDK timing contract

**Files:**
- Modify: `packages/sdk/src/model/model-manager.ts`
- Modify: `packages/sdk/src/detector.ts`
- Test: `packages/sdk/tests/model-manager.test.ts`
- Test: `packages/sdk/tests/detector.test.ts`

- [x] Add failing assertions for `modelDownloadMs`, `modelCacheMs`, `integrityMs`, and `modelSource` on network and cache paths.
- [x] Run the focused SDK tests and confirm they fail because the fields are absent.
- [x] Measure download/cache/integrity phases in `ModelManager`, propagate the additive fields through detector load timings, and preserve `modelMs` as the aggregate acquisition/verification duration.
- [x] Run the focused SDK tests, then the full SDK test suite.

### Task 2: Add local official sample catalog

**Files:**
- Create: `apps/demo/public/samples/layout-demo.jpg`
- Create: `apps/demo/public/samples/doc-formula.png`
- Create: `apps/demo/public/samples/table.png`
- Create: `apps/demo/public/samples/image-layout.jpg`
- Create: `apps/demo/src/samples.ts`
- Modify: `apps/demo/src/App.tsx`
- Modify: `apps/demo/src/i18n/zh-CN.ts`
- Modify: `apps/demo/src/i18n/en.ts`
- Modify: `apps/demo/src/styles.css`
- Test: `apps/demo/tests/demo.spec.ts`

- [x] Add a failing Playwright test for the sample gallery and preview-only selection behavior.
- [x] Run the focused Demo test and confirm it fails because the gallery is absent.
- [x] Copy the four locked fixture images into `public/samples`, add metadata/source links, and wire cards to fetch a local image into a `File` before calling the existing `onImage` path.
- [x] Render sample cards, attribution, and detailed timing labels in both languages.
- [x] Run the Demo tests and build.

### Task 3: Verify and commit

- [x] Run `pnpm verify` from `work/task20-release-lf`.
- [x] Run package build/smoke and browser Demo tests with fresh output.
- [ ] Review the diff, stage only intended files, and commit on `develop`.
