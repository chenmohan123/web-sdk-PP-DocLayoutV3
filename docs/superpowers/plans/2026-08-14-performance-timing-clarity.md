# Performance Timing Clarity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Demo performance panel clearly distinguish one-time initialization timings from the current detection's end-to-end and phase timings.

**Architecture:** Preserve the existing SDK timing fields and single collapsible performance section. Add semantic grouping and localized explanatory copy in the Demo, then document the two timing scopes without introducing computed overhead metrics.

**Tech Stack:** React 19, TypeScript, CSS, Playwright, Markdown, Vite, ESLint

---

## File Structure

- Modify `apps/demo/tests/demo.spec.ts`: browser assertions for timing group structure, order, labels, and explanatory note.
- Modify `apps/demo/src/i18n/zh-CN.ts`: Chinese group labels and timing terminology.
- Modify `apps/demo/src/i18n/en.ts`: English group labels and timing terminology.
- Modify `apps/demo/src/App.tsx`: divide the existing timing list into initialization and current-detection groups.
- Modify `apps/demo/src/styles.css`: compact group, total-row, and note hierarchy.
- Modify `docs/zh-CN/performance.md`: explain initialization versus per-detection timing scope in Chinese.
- Modify `docs/en/performance.md`: explain the same timing scopes in English.

### Task 1: Add The Timing Hierarchy Regression Test

**Files:**
- Modify: `apps/demo/tests/demo.spec.ts:6-65`

- [ ] **Step 1: Write the failing browser assertions**

After the existing completed-detection assertion, add:

```ts
const performance = page.getByTestId("performance-section");
const initialization = performance.getByTestId("initialization-timings");
const detection = performance.getByTestId("detection-timings");

await expect(initialization.getByText("初始化", { exact: true })).toBeVisible();
await expect(detection.getByText("本次检测", { exact: true })).toBeVisible();
await expect(initialization.getByText("初始化总耗时", { exact: true })).toBeVisible();
await expect(detection.getByText("端到端耗时", { exact: true })).toBeVisible();
await expect(detection.getByText("图片解码", { exact: true })).toBeVisible();
await expect(detection.getByText("模型推理", { exact: true })).toBeVisible();
await expect(detection).toContainText(
  "端到端耗时还包含 Worker 通信与结果传输等少量开销。"
);
expect(
  await performance.evaluate((section: HTMLElement) => {
    const initializationGroup = section.querySelector('[data-testid="initialization-timings"]');
    const detectionGroup = section.querySelector('[data-testid="detection-timings"]');
    return Boolean(
      initializationGroup &&
      detectionGroup &&
      initializationGroup.compareDocumentPosition(detectionGroup) &
        Node.DOCUMENT_POSITION_FOLLOWING
    );
  })
).toBe(true);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run a local Demo server and then:

```powershell
.\node_modules\.bin\playwright.CMD test tests\demo.spec.ts --grep "complete detection workflow"
```

Expected: FAIL because `initialization-timings`, `detection-timings`, and the new localized labels do not exist.

### Task 2: Implement Localized Timing Groups

**Files:**
- Modify: `apps/demo/src/i18n/zh-CN.ts`
- Modify: `apps/demo/src/i18n/en.ts`
- Modify: `apps/demo/src/App.tsx:480-531`
- Modify: `apps/demo/src/styles.css`

- [ ] **Step 1: Add localized copy**

Extend the `Copy` shape through the Chinese source object and English implementation with these exact values:

```ts
// zh-CN.ts
initializationGroup: "初始化",
detectionGroup: "本次检测",
total: "端到端耗时",
decode: "图片解码",
inference: "模型推理",
timingOverhead: "端到端耗时还包含 Worker 通信与结果传输等少量开销。",
```

```ts
// en.ts
initializationGroup: "Initialization",
detectionGroup: "Current detection",
total: "End-to-end time",
decode: "Image decode",
inference: "Model inference",
timingOverhead:
  "End-to-end time also includes small Worker communication and result-transfer overhead.",
```

- [ ] **Step 2: Group the existing metric rows without changing their data sources**

Within `data-testid="performance-section"`, keep the existing `metric-list`, but wrap the initialization and detection rows as sibling groups:

```tsx
<div className="timing-group" data-testid="initialization-timings">
  <h3 className="timing-group-title">{copy.initializationGroup}</h3>
  <div className="metric-row metric-total">
    <dt>{copy.loadTotal}</dt>
    <dd>{formatMs(loadTimings?.totalMs)}</dd>
  </div>
  {/* existing download, cache, integrity, source, and session rows */}
</div>
<div className="timing-group" data-testid="detection-timings">
  <h3 className="timing-group-title">{copy.detectionGroup}</h3>
  <div className="metric-row metric-total">
    <dt>{copy.total}</dt>
    <dd data-testid="timing-total">{formatMs(result?.timings.totalMs)}</dd>
  </div>
  {/* existing decode, preprocess, inference, and postprocess rows */}
  <p className="timing-note">{copy.timingOverhead}</p>
</div>
```

Retain these bindings unchanged:

```ts
loadTimings?.totalMs
loadTimings?.modelDownloadMs
loadTimings?.modelCacheMs
loadTimings?.integrityMs
loadTimings?.modelSource
loadTimings?.sessionMs
result?.timings.totalMs
result?.timings.decodeMs
result?.timings.preprocessMs
result?.timings.inferenceMs
result?.timings.postprocessMs
```

- [ ] **Step 3: Add compact visual hierarchy**

Add CSS following the existing performance panel palette:

```css
.timing-group + .timing-group {
  border-top: 1px solid var(--line);
  margin-top: 12px;
  padding-top: 12px;
}

.timing-group-title {
  color: var(--muted);
  font-size: 0.72rem;
  font-weight: 700;
  margin: 0 0 6px;
  text-transform: uppercase;
}

.metric-row {
  align-items: baseline;
  display: flex;
  justify-content: space-between;
}

.metric-total {
  color: var(--ink);
  font-weight: 700;
}

.timing-note {
  color: var(--muted);
  font-size: 0.72rem;
  line-height: 1.45;
  margin: 8px 0 0;
}
```

Adapt property values to the repository's actual CSS custom properties and existing `.metric-list` rules; do not introduce a nested card or additional panel.

- [ ] **Step 4: Run focused checks and verify GREEN**

Run:

```powershell
.\node_modules\.bin\tsc.CMD --noEmit
..\..\node_modules\.bin\eslint.CMD src tests
.\node_modules\.bin\playwright.CMD test tests\demo.spec.ts --grep "complete detection workflow"
```

Expected: TypeScript and ESLint exit 0; the focused browser test passes when ORT assets are reachable. If inference is blocked by the known external CDN restriction, verify the new hierarchy with the local sample flow and report that environmental limitation explicitly.

### Task 3: Document The Two Timing Scopes

**Files:**
- Modify: `docs/zh-CN/performance.md:5`
- Modify: `docs/en/performance.md:5`

- [ ] **Step 1: Expand the Chinese timing explanation**

Replace the opening timing paragraph with:

```markdown
性能指标分成两个独立范围。`detector.loadTimings` 记录一次性的初始化过程：能力探测、manifest 获取、模型下载或缓存读取、完整性校验和 Session 创建；其中 `totalMs` 是整个初始化过程的墙钟时间。`result.timings` 记录当前图片的单次检测：图片解码、预处理、模型推理和后处理；其中 `totalMs` 是从开始处理图片到返回检测结果的端到端墙钟时间，还包含 Worker 通信、调度和结果传输等少量开销，因此各阶段耗时之和不一定与 `totalMs` 完全相等。
```

- [ ] **Step 2: Expand the English timing explanation**

Replace the opening timing paragraph with:

```markdown
Performance metrics have two independent scopes. `detector.loadTimings` records one-time initialization: capability probing, manifest retrieval, model download or cache access, integrity verification, and Session creation; its `totalMs` is the wall-clock duration of the full initialization. `result.timings` records the current image detection: image decode, preprocessing, model inference, and postprocessing; its `totalMs` is the end-to-end wall-clock duration from starting image processing until the result is returned. It also includes small amounts of Worker communication, scheduling, and result-transfer overhead, so the phase timings do not necessarily sum exactly to `totalMs`.
```

- [ ] **Step 3: Verify documentation formatting**

Run:

```powershell
git diff --check
```

Expected: exit 0 with no whitespace errors.

### Task 4: Final Verification And Visual Review

**Files:**
- Verify all files modified by Tasks 1-3.

- [ ] **Step 1: Run static verification**

Run:

```powershell
cd apps\demo
.\node_modules\.bin\tsc.CMD --noEmit
..\..\node_modules\.bin\eslint.CMD src tests
.\node_modules\.bin\vite.CMD build
cd ..\..\packages\sdk
.\node_modules\.bin\vitest.CMD run
.\node_modules\.bin\tsc.CMD --noEmit
.\node_modules\.bin\eslint.CMD src tests
```

Expected: all commands exit 0; SDK reports all existing test files and tests passed.

- [ ] **Step 2: Run responsive browser regression tests**

Run the Demo Playwright suite against a clean local server:

```powershell
.\node_modules\.bin\playwright.CMD test tests\demo.spec.ts
```

Expected: all tests pass when ORT runtime assets are reachable. If the environment cannot fetch the external ORT module, record the exact failed network URL while confirming all non-inference layout tests pass.

- [ ] **Step 3: Inspect desktop and mobile rendering**

Use the in-app browser at `1440x900` and `390x844`. Confirm:

- `Initialization` precedes `Current detection`.
- Each total row is visually stronger than child rows.
- The explanatory note wraps without overlapping adjacent content.
- The performance panel remains compact.
- No horizontal overflow occurs.

- [ ] **Step 4: Run final diff checks**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors and no temporary test or diagnostic files.
