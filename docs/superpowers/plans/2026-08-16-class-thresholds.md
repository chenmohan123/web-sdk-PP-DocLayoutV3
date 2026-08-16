# Per-Class Detection Thresholds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-class confidence thresholds to the SDK and a responsive per-class threshold editor to the Demo while preserving global top-k and mask-threshold behavior.

**Architecture:** Extend the existing detect-option shape through the detector, main-thread executor, Worker protocol, and shared postprocessor. Resolve class-name overrides only after the existing global top-k selection, while continuing to pass the global threshold to mask polygon extraction. Keep Demo label and map normalization in a focused pure module, with `App.tsx` responsible only for state and rendering.

**Tech Stack:** TypeScript 5.9, Vitest, React 19, Vite 7, Playwright, ONNX Runtime Web, pnpm, API Extractor

---

## File Structure

- Modify `packages/sdk/src/postprocess.ts`: validate class overrides and apply them to confidence filtering without changing mask thresholding.
- Modify `packages/sdk/src/detector.ts`: publish `classThresholds` and pass it through the main-thread executor.
- Modify `packages/sdk/src/worker/worker-bridge.ts`: add the option to the internal executor contract and Worker request payload.
- Modify `packages/sdk/src/worker/protocol.ts`: type the structured-cloneable class threshold map.
- Modify `packages/sdk/src/worker/inference.worker.ts`: pass Worker overrides to shared postprocessing.
- Modify `packages/sdk/tests/postprocess.test.ts`: lock override, fallback, duplicate-label, validation, top-k, and mask behavior.
- Modify `packages/sdk/tests/detector.test.ts`: lock public-to-executor option forwarding.
- Modify `packages/sdk/tests/worker-bridge.test.ts`: lock Worker payload forwarding.
- Create `apps/demo/src/class-thresholds.ts`: own pinned default labels, label de-duplication, and active-map selection.
- Modify `apps/demo/src/App.tsx`: own editor state, render controls, and pass non-empty active overrides to `detect()`.
- Modify `apps/demo/src/i18n/zh-CN.ts` and `apps/demo/src/i18n/en.ts`: add editor copy and accessible names.
- Modify `apps/demo/src/styles.css`: add the unframed collapsible editor and responsive grid.
- Modify `apps/demo/tests/demo.spec.ts`: cover pure mapping, interaction, end-to-end override behavior, localization, and overflow.
- Modify `README.md`, `README.en.md`, `packages/sdk/README.md`, `docs/en/api.md`, `docs/zh-CN/api.md`, `docs/en/quick-start.md`, and `docs/zh-CN/quick-start.md`: document the API and confidence-versus-mask semantics.
- Modify `scripts/check-doc-parity.test.mjs`: require the new option in public documentation.
- Regenerate `packages/sdk/etc/web-sdk-pp-doclayoutv3.api.md`: record the additive public type.

### Task 1: Implement Shared Postprocessing Semantics

**Files:**
- Modify: `packages/sdk/tests/postprocess.test.ts`
- Modify: `packages/sdk/src/postprocess.ts`

- [ ] **Step 1: Write failing per-class behavior tests**

Add these cases inside the existing `describe("postprocessDetections", ...)` block:

```ts
it("uses class thresholds with global fallback for duplicate label names", () => {
  const detections = postprocessDetections(outputsFor(reference.synthetic), {
    classThresholds: { content: 0.5, footer: 0.85, image: 0.8 },
    inputSize: reference.synthetic.inputSize,
    labels: reference.synthetic.labels,
    targetSize: reference.synthetic.targetSize,
    threshold: 0.6
  });

  expect(detections.map(({ labelId }) => labelId)).toEqual([0, 2]);
});

it("keeps class threshold boundaries inclusive", () => {
  const detections = postprocessDetections(outputsFor(reference.synthetic), {
    classThresholds: { content: 0.5 },
    inputSize: reference.synthetic.inputSize,
    labels: reference.synthetic.labels,
    targetSize: reference.synthetic.targetSize,
    threshold: 0.95
  });

  expect(detections.map(({ labelId }) => labelId)).toEqual([2]);
});

it("does not resurrect class candidates outside the global top-k", () => {
  const outputs: PPDocLayoutRawOutputs = {
    logits: { data: Float32Array.from([10, 9]), dims: [1, 1, 2] },
    orderLogits: { data: new Float32Array(1), dims: [1, 1, 1] },
    outMasks: { data: new Float32Array(4), dims: [1, 1, 2, 2] },
    predBoxes: {
      data: Float32Array.from([0.5, 0.5, 0.5, 0.5]),
      dims: [1, 1, 4]
    }
  };

  const detections = postprocessDetections(outputs, {
    classThresholds: { first: 1, second: 0 },
    inputSize: { height: 8, width: 8 },
    labels: ["first", "second"],
    targetSize: { height: 100, width: 100 },
    threshold: 0.5
  });

  expect(detections).toEqual([]);
});

it("rejects invalid and unknown class thresholds", () => {
  const base = {
    inputSize: reference.synthetic.inputSize,
    labels: reference.synthetic.labels,
    targetSize: reference.synthetic.targetSize,
    threshold: 0.5
  };

  expect(() =>
    postprocessDetections(outputsFor(reference.synthetic), {
      ...base,
      classThresholds: { missing: 0.4 }
    })
  ).toThrow(/not present/i);
  expect(() =>
    postprocessDetections(outputsFor(reference.synthetic), {
      ...base,
      classThresholds: { content: Number.NaN }
    })
  ).toThrow(/between zero and one/i);
});

it("does not use class confidence thresholds for mask polygons", () => {
  const outputs = outputsFor(reference.synthetic);
  const baseline = postprocessDetections(outputs, {
    inputSize: reference.synthetic.inputSize,
    labels: reference.synthetic.labels,
    targetSize: reference.synthetic.targetSize,
    threshold: 0.5
  });
  const overridden = postprocessDetections(outputs, {
    classThresholds: { footer: 0.85 },
    inputSize: reference.synthetic.inputSize,
    labels: reference.synthetic.labels,
    targetSize: reference.synthetic.targetSize,
    threshold: 0.5
  });

  expect(overridden[0]?.polygon).toEqual(baseline[0]?.polygon);
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```bash
pnpm --filter web-sdk-pp-doclayoutv3 exec vitest run tests/postprocess.test.ts
```

Expected: FAIL because `classThresholds` is not read, unknown names are not rejected, and duplicate-label filtering still uses only the global threshold.

- [ ] **Step 3: Add the postprocessing option and validation**

Extend `PostprocessOptions` and replace the scalar return from `validateOptions()` with a validated structure:

```ts
export interface PostprocessOptions {
  readonly classThresholds?: Readonly<Record<string, number>>;
  readonly inputSize: ImageSize;
  readonly labels: readonly string[];
  readonly targetSize: ImageSize;
  readonly threshold?: number;
}

interface ValidatedThresholds {
  readonly classThresholds: Readonly<Record<string, number>>;
  readonly threshold: number;
}

function assertThreshold(name: string, threshold: number): void {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw inferenceError(`${name} must be between zero and one`, { threshold });
  }
}

function validateOptions(options: PostprocessOptions): ValidatedThresholds {
  const threshold = options.threshold ?? 0.5;
  assertThreshold("Detection threshold", threshold);
  const classThresholds = options.classThresholds ?? {};
  const labels = new Set(options.labels);
  for (const [label, classThreshold] of Object.entries(classThresholds)) {
    if (!labels.has(label)) {
      throw inferenceError("Class threshold label is not present in the model manifest", {
        label
      });
    }
    assertThreshold(`Class threshold for ${label}`, classThreshold);
  }
  for (const [name, size] of [
    ["input", options.inputSize],
    ["target", options.targetSize]
  ] as const) {
    if (
      !Number.isFinite(size.width) ||
      !Number.isFinite(size.height) ||
      size.width <= 0 ||
      size.height <= 0
    ) {
      throw inferenceError(`${name} image dimensions are invalid`, { ...size });
    }
  }
  return { classThresholds, threshold };
}
```

- [ ] **Step 4: Preserve top-k and apply effective confidence thresholds afterward**

Remove the threshold argument and final filter from `selectCandidates()`:

```ts
function selectCandidates(
  logits: Float32Array,
  queries: number,
  classes: number
): Candidate[] {
  const candidates = new Array<Candidate>(queries * classes);
  for (let flatIndex = 0; flatIndex < candidates.length; flatIndex += 1) {
    candidates[flatIndex] = {
      flatIndex,
      labelId: flatIndex % classes,
      query: Math.floor(flatIndex / classes),
      score: sigmoid(logits[flatIndex]!)
    };
  }
  candidates.sort((left, right) => right.score - left.score || left.flatIndex - right.flatIndex);
  return candidates.slice(0, queries);
}
```

Then resolve overrides in `postprocessDetections()` while retaining the global value for `polygonForCandidate()`:

```ts
const thresholds = validateOptions(options);
const shape = validateOutputs(outputs, options.labels);
const ranks = readingOrderRanks(outputs.orderLogits.data, shape.queries);
const candidates = selectCandidates(outputs.logits.data, shape.queries, shape.classes)
  .filter((candidate) => {
    const label = options.labels[candidate.labelId]!;
    return candidate.score >= (thresholds.classThresholds[label] ?? thresholds.threshold);
  })
  .map<RankedCandidate>((candidate) => ({
    ...candidate,
    box: boxForQuery(outputs.predBoxes.data, candidate.query, options.targetSize),
    order: ranks[candidate.query]!
  }))
  .sort((left, right) => left.order - right.order || right.score - left.score);
```

Keep polygon creation explicitly global:

```ts
polygon: polygonForCandidate(outputs, shape, candidate, options, thresholds.threshold),
```

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```bash
pnpm --filter web-sdk-pp-doclayoutv3 exec vitest run tests/postprocess.test.ts
pnpm --filter web-sdk-pp-doclayoutv3 typecheck
```

Expected: all postprocessing tests PASS and TypeScript exits with code 0.

- [ ] **Step 6: Commit the shared behavior**

```bash
git add packages/sdk/src/postprocess.ts packages/sdk/tests/postprocess.test.ts
git commit -m "feat(sdk): support per-class postprocess thresholds"
```

### Task 2: Extend The Public Detector And Main-Thread Path

**Files:**
- Modify: `packages/sdk/tests/detector.test.ts`
- Modify: `packages/sdk/src/detector.ts`
- Modify: `packages/sdk/src/worker/worker-bridge.ts`

- [ ] **Step 1: Write a failing detector forwarding test**

Add this case to `packages/sdk/tests/detector.test.ts`:

```ts
it("forwards class thresholds to the inference executor", async () => {
  const detect = vi.fn(() =>
    Promise.resolve({
      detections: [],
      timings: { inferenceMs: 1, postprocessMs: 1, preprocessMs: 1 }
    })
  );
  const detector = await createDocLayoutWithDependencies(
    {},
    dependencies({ createExecutor: vi.fn(() => Promise.resolve(executor(detect))) })
  );
  const classThresholds = { formula: 0.4, table: 0.55 };

  await detector.detect(
    { height: 1, rgba: new Uint8ClampedArray(4), width: 1 },
    { classThresholds, threshold: 0.5 }
  );

  expect(detect).toHaveBeenCalledWith(
    expect.objectContaining({ height: 1, width: 1 }),
    { classThresholds, threshold: 0.5 }
  );
});
```

- [ ] **Step 2: Run typecheck and verify the missing public option fails**

Run:

```bash
pnpm --filter web-sdk-pp-doclayoutv3 typecheck
```

Expected: FAIL because `DocLayoutDetectOptions` does not contain `classThresholds`.

- [ ] **Step 3: Extend public and internal detect option contracts**

Add the property to both option interfaces:

```ts
export interface DocLayoutDetectOptions {
  readonly classThresholds?: Readonly<Record<string, number>>;
  readonly signal?: AbortSignal;
  readonly threshold?: number;
}
```

```ts
export interface InferenceDetectOptions {
  readonly classThresholds?: Readonly<Record<string, number>>;
  readonly signal?: AbortSignal;
  readonly threshold?: number;
}
```

- [ ] **Step 4: Pass the map into main-thread postprocessing**

Extend the `postprocessDetections()` options in `createMainExecutor()`:

```ts
const detections = postprocessDetections(inference.outputs, {
  inputSize: options.manifest.preprocessing.size,
  labels: options.manifest.labels,
  targetSize: input.originalSize,
  ...(detectOptions.classThresholds === undefined
    ? {}
    : { classThresholds: detectOptions.classThresholds }),
  ...(detectOptions.threshold === undefined ? {} : { threshold: detectOptions.threshold })
});
```

- [ ] **Step 5: Run detector tests and typecheck**

Run:

```bash
pnpm --filter web-sdk-pp-doclayoutv3 exec vitest run tests/detector.test.ts
pnpm --filter web-sdk-pp-doclayoutv3 typecheck
```

Expected: detector tests PASS and TypeScript exits with code 0.

- [ ] **Step 6: Commit the public and main-thread path**

```bash
git add packages/sdk/src/detector.ts packages/sdk/src/worker/worker-bridge.ts packages/sdk/tests/detector.test.ts
git commit -m "feat(sdk): expose class threshold detect options"
```

### Task 3: Forward Overrides Through The Worker

**Files:**
- Modify: `packages/sdk/tests/worker-bridge.test.ts`
- Modify: `packages/sdk/src/worker/protocol.ts`
- Modify: `packages/sdk/src/worker/worker-bridge.ts`
- Modify: `packages/sdk/src/worker/inference.worker.ts`

- [ ] **Step 1: Strengthen the Worker request test**

In the existing `"copies and transfers model and raster buffers with monotonic request IDs"` test, call `detect()` with both options and assert the payload:

```ts
const classThresholds = { formula: 0.4, table: 0.55 };
const pending = bridge.detect(raster(), { classThresholds, threshold: 0.5 });
const request = worker.posts[1]!;
expect(request.message).toMatchObject({
  payload: { classThresholds, threshold: 0.5 },
  requestId: 2,
  type: "detect"
});
expect(request.transfer).toHaveLength(1);
```

- [ ] **Step 2: Run the Worker test and verify failure**

Run:

```bash
pnpm --filter web-sdk-pp-doclayoutv3 exec vitest run tests/worker-bridge.test.ts
```

Expected: FAIL because the Worker payload omits `classThresholds`.

- [ ] **Step 3: Extend the Worker protocol and bridge payload**

Update `WorkerDetectPayload`:

```ts
export interface WorkerDetectPayload {
  readonly classThresholds?: Readonly<Record<string, number>>;
  readonly raster: NormalizedRaster;
  readonly threshold?: number;
}
```

Update `WorkerBridgeImplementation.detect()`:

```ts
const payload = {
  raster: { height: raster.height, rgba, width: raster.width },
  ...(options.classThresholds === undefined
    ? {}
    : { classThresholds: options.classThresholds }),
  ...(options.threshold === undefined ? {} : { threshold: options.threshold })
};
```

- [ ] **Step 4: Pass Worker overrides into shared postprocessing**

Update the Worker call:

```ts
const detections = postprocessDetections(inference.outputs, {
  inputSize: manifest.preprocessing.size,
  labels: manifest.labels,
  targetSize: input.originalSize,
  ...(message.payload.classThresholds === undefined
    ? {}
    : { classThresholds: message.payload.classThresholds }),
  ...(message.payload.threshold === undefined ? {} : { threshold: message.payload.threshold })
});
```

- [ ] **Step 5: Run Worker, SDK, and type checks**

Run:

```bash
pnpm --filter web-sdk-pp-doclayoutv3 exec vitest run tests/worker-bridge.test.ts tests/postprocess.test.ts tests/detector.test.ts
pnpm --filter web-sdk-pp-doclayoutv3 typecheck
```

Expected: all focused SDK tests PASS and TypeScript exits with code 0.

- [ ] **Step 6: Commit Worker transport**

```bash
git add packages/sdk/src/worker/protocol.ts packages/sdk/src/worker/worker-bridge.ts packages/sdk/src/worker/inference.worker.ts packages/sdk/tests/worker-bridge.test.ts
git commit -m "feat(sdk): forward class thresholds to inference workers"
```

### Task 4: Build The Demo Class Threshold Editor

**Files:**
- Create: `apps/demo/src/class-thresholds.ts`
- Modify: `apps/demo/src/App.tsx`
- Modify: `apps/demo/src/i18n/zh-CN.ts`
- Modify: `apps/demo/src/i18n/en.ts`
- Modify: `apps/demo/src/styles.css`
- Modify: `apps/demo/tests/demo.spec.ts`

- [ ] **Step 1: Write failing pure-mapping and UI tests**

Add a pure module contract test to `apps/demo/tests/demo.spec.ts`:

```ts
test("normalizes active class threshold configuration", async ({ page }) => {
  await page.goto("/?fixture=1");
  const result = await page.evaluate(async () => {
    const module = (await import("/src/class-thresholds.ts")) as typeof import(
      "../src/class-thresholds"
    );
    return {
      defaults: module.DEFAULT_CLASS_LABELS,
      selected: module.selectActiveClassThresholds(
        ["formula", "formula", "text"],
        { formula: 0.4, stale: 0.2, text: 0.6 }
      )
    };
  });

  expect(result.defaults).toContain("table");
  expect(result.defaults.filter((label) => label === "formula")).toHaveLength(1);
  expect(result.selected).toEqual({ formula: 0.4, text: 0.6 });
});
```

Add a UI test that proves the fixture override wins over a global threshold of `1`:

```ts
test("edits, applies, localizes, and clears class thresholds", async ({ page }) => {
  await page.goto("/?fixture=1");
  await page.getByText("类别阈值", { exact: true }).click();
  const textThreshold = page.getByRole("spinbutton", { name: "类别阈值 text" });
  await expect(textThreshold).toBeVisible();
  await textThreshold.fill("0");
  await page.getByRole("slider", { name: "置信度阈值" }).fill("1");
  await page.locator('input[type="file"]').setInputFiles({
    name: "threshold.png",
    mimeType: "image/png",
    buffer: Buffer.from(pixelPng, "base64")
  });
  await page.getByRole("button", { name: "开始检测" }).click();
  await expect(page.getByTestId("status")).toContainText("检测完成", { timeout: 15_000 });
  await expect(page.getByTestId("detection-section")).toContainText("text");

  await page.getByRole("button", { name: "清空类别阈值" }).click();
  await expect(textThreshold).toHaveValue("");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.getByText("Class thresholds", { exact: true })).toBeVisible();
});
```

- [ ] **Step 2: Run the focused Demo tests and verify failure**

Run:

```bash
pnpm --filter @ppdoclayout/demo exec playwright test tests/demo.spec.ts --grep "class threshold|Class threshold"
```

Expected: FAIL because the module and editor do not exist.

- [ ] **Step 3: Create label and map helpers**

Create `apps/demo/src/class-thresholds.ts`:

```ts
export function uniqueLabels(labels: readonly string[]): readonly string[] {
  return [...new Set(labels)];
}

export const DEFAULT_CLASS_LABELS = uniqueLabels([
  "abstract",
  "algorithm",
  "aside_text",
  "chart",
  "content",
  "formula",
  "doc_title",
  "figure_title",
  "footer",
  "footer",
  "footnote",
  "formula_number",
  "header",
  "header",
  "image",
  "formula",
  "number",
  "paragraph_title",
  "reference",
  "reference_content",
  "seal",
  "table",
  "text",
  "text",
  "vision_footnote"
]);

export function selectActiveClassThresholds(
  labels: readonly string[],
  thresholds: Readonly<Record<string, number>>
): Readonly<Record<string, number>> {
  const selected: Record<string, number> = {};
  for (const label of uniqueLabels(labels)) {
    const threshold = thresholds[label];
    if (threshold !== undefined) selected[label] = threshold;
  }
  return selected;
}
```

- [ ] **Step 4: Add localized copy and App state**

Add matching keys to `zhCN` and `en`:

```ts
classThresholds: "类别阈值",
classThreshold: "类别阈值",
classThresholdHint: "留空时继承全局阈值",
clearClassThresholds: "清空类别阈值",
```

```ts
classThresholds: "Class thresholds",
classThreshold: "Class threshold",
classThresholdHint: "Leave blank to inherit the global threshold",
clearClassThresholds: "Clear class thresholds",
```

Import the helpers and add state and derived values in `App.tsx`:

```ts
import {
  DEFAULT_CLASS_LABELS,
  selectActiveClassThresholds,
  uniqueLabels
} from "./class-thresholds";

const [classThresholds, setClassThresholds] = useState<Record<string, number>>({});
const activeLabels = uniqueLabels(
  customManifest?.labels ?? (demoFixture ? tinyModelManifest.labels : DEFAULT_CLASS_LABELS)
);
const activeClassThresholds = selectActiveClassThresholds(activeLabels, classThresholds);

const updateClassThreshold = (label: string, value: string): void => {
  setClassThresholds((current) => {
    const next = { ...current };
    if (value === "") delete next[label];
    else next[label] = Number(value);
    return next;
  });
};
```

Pass only a non-empty active map to `detect()`:

```ts
const nextResult = await detector.detect(file, {
  ...(Object.keys(activeClassThresholds).length === 0
    ? {}
    : { classThresholds: activeClassThresholds }),
  signal: controller.signal,
  threshold
});
```

- [ ] **Step 5: Render the collapsible editor**

Place this full-width section immediately after the existing `.control-band`:

```tsx
<details className="class-threshold-editor" data-testid="class-threshold-editor">
  <summary>
    <span>{copy.classThresholds}</span>
    <small>{copy.classThresholdHint}</small>
  </summary>
  <div className="class-threshold-toolbar">
    <span className="muted">{copy.classThresholdHint}</span>
    <button
      className="text-button"
      aria-label={copy.clearClassThresholds}
      onClick={() => setClassThresholds({})}
      type="button"
    >
      <Trash2 size={15} />
      {copy.clearClassThresholds}
    </button>
  </div>
  <div className="class-threshold-grid">
    {activeLabels.map((label) => (
      <label className="class-threshold-field" key={label}>
        <span>{label}</span>
        <input
          aria-label={`${copy.classThreshold} ${label}`}
          max="1"
          min="0"
          onChange={(event) => updateClassThreshold(label, event.target.value)}
          placeholder={threshold.toFixed(2)}
          step="0.05"
          type="number"
          value={classThresholds[label] ?? ""}
        />
      </label>
    ))}
  </div>
</details>
```

- [ ] **Step 6: Style a stable responsive grid**

Add these rules near the existing threshold controls:

```css
.class-threshold-editor {
  border-bottom: 1px solid #c9d1ce;
  padding: 0 0 13px;
}
.class-threshold-editor summary {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-height: 36px;
  cursor: pointer;
  color: #183b42;
  font-weight: 700;
}
.class-threshold-editor summary small {
  color: #688078;
  font-weight: 400;
}
.class-threshold-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}
.class-threshold-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 9px 12px;
}
.class-threshold-field {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 72px;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.class-threshold-field span {
  overflow-wrap: anywhere;
  color: #48615d;
  font-size: 12px;
}
.class-threshold-field input {
  width: 100%;
  min-width: 0;
}
```

Inside the existing `@media (max-width: 620px)` block add:

```css
.class-threshold-toolbar {
  align-items: flex-start;
  flex-direction: column;
}
.class-threshold-grid {
  grid-template-columns: 1fr;
}
```

- [ ] **Step 7: Run Demo tests, typecheck, and lint**

Run:

```bash
pnpm --filter @ppdoclayout/demo exec playwright test tests/demo.spec.ts
pnpm --filter @ppdoclayout/demo typecheck
pnpm --filter @ppdoclayout/demo lint
```

Expected: all Demo tests PASS, including existing 390 px and desktop overflow checks; typecheck and lint exit with code 0.

- [ ] **Step 8: Commit the Demo editor**

```bash
git add apps/demo/src/class-thresholds.ts apps/demo/src/App.tsx apps/demo/src/i18n/zh-CN.ts apps/demo/src/i18n/en.ts apps/demo/src/styles.css apps/demo/tests/demo.spec.ts
git commit -m "feat(demo): add class threshold editor"
```

### Task 5: Document And Publish The Additive API Shape

**Files:**
- Modify: `scripts/check-doc-parity.test.mjs`
- Modify: `README.md`
- Modify: `README.en.md`
- Modify: `packages/sdk/README.md`
- Modify: `docs/en/api.md`
- Modify: `docs/zh-CN/api.md`
- Modify: `docs/en/quick-start.md`
- Modify: `docs/zh-CN/quick-start.md`
- Regenerate: `packages/sdk/etc/web-sdk-pp-doclayoutv3.api.md`

- [ ] **Step 1: Write a failing documentation contract**

Add this test to `scripts/check-doc-parity.test.mjs`:

```js
it("documents per-class confidence thresholds in every public API guide", () => {
  const documents = [
    "README.md",
    "README.en.md",
    "packages/sdk/README.md",
    "docs/en/api.md",
    "docs/zh-CN/api.md",
    "docs/en/quick-start.md",
    "docs/zh-CN/quick-start.md"
  ].map((path) => readFileSync(new URL(path, repositoryRoot), "utf8"));

  for (const document of documents) {
    assert.match(document, /classThresholds/);
    assert.match(document, /formula/);
    assert.match(document, /mask|掩码/i);
  }
});
```

- [ ] **Step 2: Run the documentation test and verify failure**

Run:

```bash
pnpm docs:test
```

Expected: FAIL because the public documents do not yet mention `classThresholds`.

- [ ] **Step 3: Add the same API example and semantic note in both languages**

Use this TypeScript example in the READMEs and quick-start guides:

```ts
const result = await detector.detect(file, {
  threshold: 0.5,
  classThresholds: {
    formula: 0.4,
    table: 0.55,
    text: 0.6
  }
});
```

Add the English semantic note:

```md
`classThresholds` overrides confidence filtering for matching manifest label names and falls back to `threshold` for unspecified classes. The global `threshold` still controls mask binarization and polygon extraction. Unknown class names and values outside `0` through `1` are rejected.
```

Add the Chinese semantic note:

```md
`classThresholds` 按 manifest 标签名称覆盖置信度过滤阈值，未配置的类别回退到 `threshold`。全局 `threshold` 仍用于 mask 二值化和多边形提取。未知类别名称或超出 `0` 到 `1` 的值会被拒绝。
```

In both API references, change the detector signature bullet to include the new option:

```md
- `detect(image, { threshold, classThresholds, signal })`
```

- [ ] **Step 4: Regenerate the API report**

Run:

```bash
pnpm --filter web-sdk-pp-doclayoutv3 build
```

Expected: build exits with code 0 and `packages/sdk/etc/web-sdk-pp-doclayoutv3.api.md` shows `readonly classThresholds?: Readonly<Record<string, number>>;` in `DocLayoutDetectOptions`.

- [ ] **Step 5: Run documentation and API checks**

Run:

```bash
pnpm docs:test
pnpm --filter web-sdk-pp-doclayoutv3 api:report
```

Expected: documentation tests PASS and API Extractor reports no unapproved API differences.

- [ ] **Step 6: Commit documentation and API report**

```bash
git add README.md README.en.md packages/sdk/README.md docs/en/api.md docs/zh-CN/api.md docs/en/quick-start.md docs/zh-CN/quick-start.md scripts/check-doc-parity.test.mjs packages/sdk/etc/web-sdk-pp-doclayoutv3.api.md
git commit -m "docs: document per-class detection thresholds"
```

### Task 6: Complete Repository Verification

**Files:**
- Verify only; no planned source changes

- [ ] **Step 1: Run formatting checks**

Run:

```bash
pnpm format:check
```

Expected: PASS. If the repository installation still lacks the Prettier executable, repair dependencies with the repository's pinned `pnpm install --offline` before retrying; do not skip formatting silently.

- [ ] **Step 2: Run static analysis**

Run:

```bash
pnpm lint
pnpm typecheck
```

Expected: both commands exit with code 0.

- [ ] **Step 3: Run SDK, Demo, and documentation regressions**

Run:

```bash
pnpm --filter web-sdk-pp-doclayoutv3 test
pnpm --filter @ppdoclayout/demo test
pnpm docs:test
```

Expected: all Vitest, Playwright, bilingual documentation, canvas-pixel, and horizontal-overflow checks PASS.

- [ ] **Step 4: Build all packages and examples**

Run:

```bash
pnpm build
```

Expected: SDK, Worker, browser-global bundle, Demo, and examples build successfully; API Extractor accepts the report.

- [ ] **Step 5: Inspect the final change set**

Run:

```bash
git status --short
git diff --check
git log -5 --oneline
```

Expected: no uncommitted implementation changes, no whitespace errors, and separate commits for postprocessing, public options, Worker transport, Demo UI, and documentation.

- [ ] **Step 6: Start the Demo for user verification**

Run:

```bash
pnpm --filter @ppdoclayout/demo dev --host 127.0.0.1
```

Expected: Vite prints a local URL. Keep the server running and report that URL with the verified command results.
