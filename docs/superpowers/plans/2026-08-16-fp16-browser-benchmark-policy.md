# FP16 Browser Benchmark Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the seven-fixture browser benchmark apply strict equality to FP32 and the approved quality policy to FP16 while retaining diagnostic evidence on failures.

**Architecture:** Add a hardware-independent parity module beside the browser benchmark and return raw accepted/candidate detections from the page for Node-side evaluation. Build and write the report before parity assertions, then configure all benchmark artifact steps to run even after test failure.

**Tech Stack:** TypeScript, Playwright Test, Node.js test contracts, GitHub Actions, pnpm

---

### Task 1: Add precision-specific parity policy with TDD

**Files:**
- Create: `tests/browser/benchmark-parity.ts`
- Create: `tests/browser/benchmark-parity.spec.ts`

- [ ] **Step 1: Write the failing policy tests**

Create `tests/browser/benchmark-parity.spec.ts` with real detection objects and no mocks:

```ts
import { expect, test } from "playwright/test";

import {
  FP16_PARITY_THRESHOLDS,
  FP32_PARITY_THRESHOLDS,
  evaluateBrowserParity,
  type DetectionForParity
} from "./benchmark-parity";

function detection(overrides: Partial<DetectionForParity> = {}): DetectionForParity {
  return {
    box: { xMin: 0, yMin: 0, xMax: 100, yMax: 100 },
    labelId: 22,
    polygon: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 }
    ],
    readingOrder: 0,
    score: 0.9,
    ...overrides
  };
}

test("FP32 preserves strict accepted-model equality thresholds", () => {
  const result = evaluateBrowserParity("fp32", [detection()], [
    detection({
      box: { xMin: 1.01, yMin: 0, xMax: 100, yMax: 100 },
      score: 0.8989
    })
  ]);

  expect(result.parityThresholds).toEqual(FP32_PARITY_THRESHOLDS);
  expect(result.parity).toBe("failed");
  expect(result.validationErrors).toContain("box coordinate delta exceeds 1 px");
  expect(result.validationErrors).toContain("score delta exceeds 0.001");
});

test("FP16 accepts approved quantization differences", () => {
  const result = evaluateBrowserParity("fp16", [detection()], [
    detection({
      box: { xMin: 1, yMin: 0, xMax: 101, yMax: 100 },
      polygon: [
        { x: 1.5, y: 0 },
        { x: 101.5, y: 0 },
        { x: 101.5, y: 100 },
        { x: 1.5, y: 100 }
      ],
      score: 0.881
    })
  ]);

  expect(result.parityThresholds).toEqual(FP16_PARITY_THRESHOLDS);
  expect(result.parity).toBe("passed");
  expect(result.parityMetrics).toMatchObject({
    matchedDetectionPrecision: 1,
    matchedDetectionRatio: 1,
    matchedDetections: 1
  });
});

test("FP16 rejects insufficient IoU matches", () => {
  const result = evaluateBrowserParity("fp16", [detection()], [
    detection({ box: { xMin: 20, yMin: 0, xMax: 120, yMax: 100 } })
  ]);
  expect(result.parity).toBe("failed");
  expect(result.validationErrors).toContain("matched detection ratio is below 0.99");
});

test("FP16 rejects score drift above 0.02", () => {
  const result = evaluateBrowserParity("fp16", [detection()], [detection({ score: 0.879 })]);
  expect(result.parity).toBe("failed");
  expect(result.validationErrors).toContain("score delta exceeds 0.02");
});

test("FP16 rejects mean polygon distance above 2 px", () => {
  const result = evaluateBrowserParity("fp16", [detection()], [
    detection({
      polygon: [
        { x: 3, y: 0 },
        { x: 103, y: 0 },
        { x: 103, y: 100 },
        { x: 3, y: 100 }
      ]
    })
  ]);
  expect(result.parity).toBe("failed");
  expect(result.validationErrors).toContain("mean polygon distance exceeds 2 px");
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
pnpm exec playwright test tests/browser/benchmark-parity.spec.ts
```

Expected: FAIL because `tests/browser/benchmark-parity.ts` does not exist.

- [ ] **Step 3: Implement the pure parity module**

Create `tests/browser/benchmark-parity.ts` with these exported contracts and algorithms:

```ts
export interface DetectionForParity {
  box: { xMax: number; xMin: number; yMax: number; yMin: number };
  labelId: number;
  polygon: Array<{ x: number; y: number }>;
  readingOrder: number;
  score: number;
}

export const FP32_PARITY_THRESHOLDS = {
  maxBoxCoordinateDeltaPixels: 1,
  maxPolygonCoordinateDeltaPixels: 1.5,
  maxScoreDelta: 0.001,
  policy: "fp32-equality"
} as const;

export const FP16_PARITY_THRESHOLDS = {
  iou: 0.95,
  matchedDetectionRatio: 0.99,
  maxScoreDelta: 0.02,
  meanPolygonPointDistancePixels: 2,
  policy: "fp16-quality"
} as const;

type Precision = "fp16" | "fp32";

export interface BrowserParityResult {
  parity: "failed" | "passed";
  parityMetrics: Record<string, number | null>;
  parityThresholds: typeof FP16_PARITY_THRESHOLDS | typeof FP32_PARITY_THRESHOLDS;
  validationErrors: string[];
}

function boxIou(left: DetectionForParity["box"], right: DetectionForParity["box"]): number {
  const intersectionWidth = Math.max(0, Math.min(left.xMax, right.xMax) - Math.max(left.xMin, right.xMin));
  const intersectionHeight = Math.max(0, Math.min(left.yMax, right.yMax) - Math.max(left.yMin, right.yMin));
  const intersection = intersectionWidth * intersectionHeight;
  const leftArea = Math.max(0, left.xMax - left.xMin) * Math.max(0, left.yMax - left.yMin);
  const rightArea = Math.max(0, right.xMax - right.xMin) * Math.max(0, right.yMax - right.yMin);
  const union = leftArea + rightArea - intersection;
  return union === 0 ? 0 : intersection / union;
}

function polygonDistance(left: DetectionForParity["polygon"], right: DetectionForParity["polygon"]): number {
  if (left.length === 0 || left.length !== right.length) return Number.POSITIVE_INFINITY;
  return left.reduce((sum, point, index) => {
    const candidate = right[index]!;
    return sum + Math.hypot(point.x - candidate.x, point.y - candidate.y);
  }, 0) / left.length;
}

function evaluateFp16(accepted: DetectionForParity[], candidate: DetectionForParity[]): BrowserParityResult {
  const possible = accepted.flatMap((reference, acceptedIndex) =>
    candidate.flatMap((target, candidateIndex) => {
      if (reference.labelId !== target.labelId) return [];
      const iou = boxIou(reference.box, target.box);
      return iou < FP16_PARITY_THRESHOLDS.iou ? [] : [{ acceptedIndex, candidateIndex, iou }];
    })
  ).sort((left, right) => right.iou - left.iou);
  const usedAccepted = new Set<number>();
  const usedCandidate = new Set<number>();
  const matches = possible.filter(({ acceptedIndex, candidateIndex }) => {
    if (usedAccepted.has(acceptedIndex) || usedCandidate.has(candidateIndex)) return false;
    usedAccepted.add(acceptedIndex);
    usedCandidate.add(candidateIndex);
    return true;
  });
  const scoreDeltas = matches.map(({ acceptedIndex, candidateIndex }) =>
    Math.abs(accepted[acceptedIndex]!.score - candidate[candidateIndex]!.score)
  );
  const polygonDistances = matches
    .map(({ acceptedIndex, candidateIndex }) =>
      polygonDistance(accepted[acceptedIndex]!.polygon, candidate[candidateIndex]!.polygon)
    )
    .filter(Number.isFinite);
  const metrics = {
    acceptedDetections: accepted.length,
    candidateDetections: candidate.length,
    matchedDetectionPrecision: candidate.length === 0 ? 0 : matches.length / candidate.length,
    matchedDetectionRatio: accepted.length === 0 ? 0 : matches.length / accepted.length,
    matchedDetections: matches.length,
    maxScoreDelta: scoreDeltas.length === 0 ? null : Math.max(...scoreDeltas),
    meanPolygonPointDistancePixels:
      polygonDistances.length === 0
        ? null
        : polygonDistances.reduce((sum, value) => sum + value, 0) / polygonDistances.length,
    unmatchedCandidateDetections: candidate.length - matches.length
  };
  const validationErrors: string[] = [];
  if (metrics.matchedDetectionRatio < FP16_PARITY_THRESHOLDS.matchedDetectionRatio)
    validationErrors.push("matched detection ratio is below 0.99");
  if (metrics.matchedDetectionPrecision < FP16_PARITY_THRESHOLDS.matchedDetectionRatio)
    validationErrors.push("matched detection precision is below 0.99");
  if (metrics.maxScoreDelta === null || metrics.maxScoreDelta > FP16_PARITY_THRESHOLDS.maxScoreDelta)
    validationErrors.push("score delta exceeds 0.02");
  if (
    metrics.meanPolygonPointDistancePixels === null ||
    metrics.meanPolygonPointDistancePixels > FP16_PARITY_THRESHOLDS.meanPolygonPointDistancePixels
  ) validationErrors.push("mean polygon distance exceeds 2 px");
  return {
    parity: validationErrors.length === 0 ? "passed" : "failed",
    parityMetrics: metrics,
    parityThresholds: FP16_PARITY_THRESHOLDS,
    validationErrors
  };
}

function evaluateFp32(accepted: DetectionForParity[], candidate: DetectionForParity[]): BrowserParityResult {
  let boxDelta = 0;
  let polygonDelta = 0;
  let scoreDelta = 0;
  const validationErrors: string[] = [];
  if (accepted.length !== candidate.length) validationErrors.push("detection count differs");
  if (JSON.stringify(accepted.map(({ labelId }) => labelId)) !== JSON.stringify(candidate.map(({ labelId }) => labelId)))
    validationErrors.push("label sequence differs");
  if (JSON.stringify(accepted.map(({ readingOrder }) => readingOrder)) !== JSON.stringify(candidate.map(({ readingOrder }) => readingOrder)))
    validationErrors.push("reading order differs");
  if (accepted.length === candidate.length) {
    for (const [index, target] of candidate.entries()) {
      const reference = accepted[index]!;
      for (const coordinate of ["xMin", "xMax", "yMin", "yMax"] as const)
        boxDelta = Math.max(boxDelta, Math.abs(target.box[coordinate] - reference.box[coordinate]));
      scoreDelta = Math.max(scoreDelta, Math.abs(target.score - reference.score));
      if (target.polygon.length !== reference.polygon.length) polygonDelta = Number.POSITIVE_INFINITY;
      else for (const [pointIndex, point] of target.polygon.entries()) {
        const referencePoint = reference.polygon[pointIndex]!;
        polygonDelta = Math.max(polygonDelta, Math.abs(point.x - referencePoint.x), Math.abs(point.y - referencePoint.y));
      }
    }
  }
  if (boxDelta > FP32_PARITY_THRESHOLDS.maxBoxCoordinateDeltaPixels)
    validationErrors.push("box coordinate delta exceeds 1 px");
  if (polygonDelta > FP32_PARITY_THRESHOLDS.maxPolygonCoordinateDeltaPixels)
    validationErrors.push("polygon coordinate delta exceeds 1.5 px");
  if (scoreDelta > FP32_PARITY_THRESHOLDS.maxScoreDelta)
    validationErrors.push("score delta exceeds 0.001");
  return {
    parity: validationErrors.length === 0 ? "passed" : "failed",
    parityMetrics: {
      maxBoxCoordinateDeltaPixels: Number.isFinite(boxDelta) ? boxDelta : null,
      maxPolygonCoordinateDeltaPixels: Number.isFinite(polygonDelta) ? polygonDelta : null,
      maxScoreDelta: scoreDelta
    },
    parityThresholds: FP32_PARITY_THRESHOLDS,
    validationErrors
  };
}

export function evaluateBrowserParity(
  precision: Precision,
  accepted: DetectionForParity[],
  candidate: DetectionForParity[]
): BrowserParityResult {
  return precision === "fp16" ? evaluateFp16(accepted, candidate) : evaluateFp32(accepted, candidate);
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```powershell
pnpm exec playwright test tests/browser/benchmark-parity.spec.ts
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit the policy module**

```powershell
git add -- tests/browser/benchmark-parity.ts tests/browser/benchmark-parity.spec.ts
git commit -m "test: add precision-specific benchmark parity"
```

### Task 2: Integrate policy and retain failure evidence

**Files:**
- Modify: `scripts/benchmark-contract.test.mjs`
- Modify: `tests/browser/benchmark.spec.ts`
- Modify: `.github/workflows/benchmark.yml`

- [ ] **Step 1: Add failing integration contract assertions**

In the existing `provides a manual hardware benchmark workflow` test, add:

```js
assert.equal(
  workflow.match(/- if:\s*always\(\)\s*\r?\n\s*uses: actions\/upload-artifact@v7/g)?.length ?? 0,
  3,
  "every benchmark result must upload after success or failure"
);
assert.equal(
  workflow.match(/if-no-files-found:\s*warn/g)?.length ?? 0,
  3,
  "missing failure evidence must remain visible"
);
assert.match(benchmark, /evaluateBrowserParity/);
assert.ok(
  benchmark.indexOf("writeFileSync(join(outputRoot") < benchmark.indexOf('expect(fixture.parity)'),
  "benchmark evidence must be written before parity assertions"
);
```

- [ ] **Step 2: Run the benchmark contract and verify RED**

Run:

```powershell
node --test scripts/benchmark-contract.test.mjs
```

Expected: FAIL because the workflow lacks unconditional uploads and the benchmark does not import `evaluateBrowserParity`.

- [ ] **Step 3: Move parity evaluation to Node and write evidence before assertions**

Update `tests/browser/benchmark.spec.ts` to import the policy:

```ts
import { evaluateBrowserParity } from "./benchmark-parity";
```

Inside `page.evaluate`, remove `compareDetections`, `numericParity`, and browser-side policy thresholds. Return both detection arrays for every fixture:

```ts
fixtureResults.push({
  acceptedDetections: acceptedDetection.detections,
  acceptedOutputSha256,
  detectionCount: detection.detections.length,
  detections: detection.detections,
  expectedDetectionCount: acceptedDetection.detections.length,
  filename: fixture.filename,
  fixtureSha256: fixture.sha256,
  outputSha256,
  timings: detection.timings
});
```

After runtime/model checks, evaluate all fixtures, build the report, and write it before expectations:

```ts
const evaluatedFixtures = result.fixtures.map(
  ({ acceptedDetections, detections, ...fixture }) => ({
    ...fixture,
    ...evaluateBrowserParity(precision, acceptedDetections, detections),
    detections
  })
);
const validationErrors = evaluatedFixtures.flatMap((fixture) =>
  fixture.validationErrors.map((message) => `${fixture.filename}: ${message}`)
);
const fixtureEvidence = evaluatedFixtures.map(({ detections, ...fixture }) => {
  if (fixture.filename !== "table.png") return fixture;
  const firstDetection = detections[0]!;
  const referenceMetrics = {
    iou: boxIou(firstDetection.box),
    maxScoreDelta: Math.abs(firstDetection.score - reference.realImage.expected.scores[0]!),
    meanPolygonPointDistancePixels: meanPolygonPointDistance(firstDetection.polygon)
  };
  return { ...fixture, referenceMetrics, referenceThresholds };
});
const report = {
  schemaVersion: 1,
  status: validationErrors.length === 0 ? "passed" : "failed",
  validationErrors,
  acceptedModelSha256: acceptedManifest.variants.find(({ id }) => id === "fp32")!.sha256,
  executionProvider: backend,
  precision,
  fallbacks: result.runtime.fallbacks,
  modelBytes: result.model.bytes,
  modelSha256: result.model.sha256,
  onnxruntimeWebVersion: "1.27.0",
  adapter: result.adapter,
  adapterFeatures: result.adapterFeatures,
  browser: { name: "Chromium", version: browser.version(), userAgent: result.browser },
  operatingSystem: `${platform()} ${release()}`,
  fixtures: fixtureEvidence,
  timingsMs: result.timings,
  sdkCommit,
  capabilities: result.runtime.capabilities,
  cpu: cpus()[0]?.model ?? "unknown",
  generatedAt: new Date().toISOString(),
  id: mode
};
mkdirSync(outputRoot, { recursive: true });
writeFileSync(join(outputRoot, `${mode}.json`), `${JSON.stringify(report, null, 2)}\n`);
expect(validationErrors).toEqual([]);
for (const fixture of evaluatedFixtures) expect(fixture.parity).toBe("passed");
```

Keep the existing runtime, model hash, table reference, adapter, timing, and output hash evidence. Remove only the duplicated browser-side parity implementation and assertions tied exclusively to the FP32 metric shape.

- [ ] **Step 4: Make benchmark artifacts upload after failures**

For each of `benchmark-wasm-fp32`, `benchmark-webgpu-fp16`, and `benchmark-webgpu-fp32` in `.github/workflows/benchmark.yml`, use:

```yaml
      - if: always()
        uses: actions/upload-artifact@v7
        with:
          name: benchmark-webgpu-fp16
          path: test-results/benchmark/webgpu-fp16.json
          if-no-files-found: warn
```

Use the matching artifact name/path for each job. Leave `responsive-screenshots` unchanged.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```powershell
pnpm exec playwright test tests/browser/benchmark-parity.spec.ts
node --test scripts/benchmark-contract.test.mjs
```

Expected: policy tests pass and benchmark contract reports 5 passing tests.

- [ ] **Step 6: Commit benchmark integration**

```powershell
git add -- tests/browser/benchmark.spec.ts scripts/benchmark-contract.test.mjs .github/workflows/benchmark.yml
git commit -m "fix: validate FP16 benchmarks with accepted policy"
```

### Task 3: Verify software and physical GPU behavior

**Files:**
- Verify only: repository and generated ignored `test-results/benchmark/*.json`

- [ ] **Step 1: Run formatting and focused static checks**

Run:

```powershell
pnpm exec prettier --check tests/browser/benchmark-parity.ts tests/browser/benchmark-parity.spec.ts tests/browser/benchmark.spec.ts scripts/benchmark-contract.test.mjs .github/workflows/benchmark.yml docs/superpowers/specs/2026-08-16-fp16-browser-benchmark-policy-design.md docs/superpowers/plans/2026-08-16-fp16-browser-benchmark-policy.md
pnpm lint
pnpm typecheck
```

Expected: all commands exit zero.

- [ ] **Step 2: Run full repository verification**

Run:

```powershell
pnpm run verify
```

Expected: documentation, release contracts, benchmark contracts, lint, type checks, tests, and builds pass. If the known unreadable ignored pytest directory blocks only the full-directory Prettier scan, run the same verified subcommands individually and require GitHub CI to execute the combined command on a clean checkout.

- [ ] **Step 3: Run physical WebGPU FP16 locally**

Run:

```powershell
$env:PPDOCLAYOUT_BENCHMARK_MODE = "webgpu-fp16"
pnpm exec playwright test tests/browser/benchmark.spec.ts
```

Expected: 1 test passes; `test-results/benchmark/webgpu-fp16.json` has `status: "passed"`, seven passing fixtures, `precision: "fp16"`, `executionProvider: "webgpu"`, and `fallbacks: []`.

- [ ] **Step 4: Run physical WebGPU FP32 regression locally**

Run:

```powershell
$env:PPDOCLAYOUT_BENCHMARK_MODE = "webgpu-fp32"
pnpm exec playwright test tests/browser/benchmark.spec.ts
```

Expected: 1 test passes; the report retains `policy: "fp32-equality"`, seven passing fixtures, and the original strict thresholds.

- [ ] **Step 5: Confirm the branch is clean and commits are scoped**

Run:

```powershell
git status --short --branch
git diff --check origin/main...HEAD
git log --oneline origin/main..HEAD
```

Expected: no uncommitted files; the branch contains the design, plan, policy, and integration commits only.

### Task 4: PR, merge, and main-branch hardware gate

**Files:**
- No additional source files

- [ ] **Step 1: Push and create the PR**

Run:

```powershell
git push -u origin codex/fp16-benchmark-policy
gh pr create --base main --head codex/fp16-benchmark-policy --title "fix: apply accepted FP16 browser benchmark policy" --body "Separates FP32 equality from FP16 quality validation, preserves seven-fixture evidence on failure, and uploads benchmark artifacts unconditionally."
```

Expected: GitHub returns the new PR URL.

- [ ] **Step 2: Require PR checks to pass**

Run:

```powershell
gh pr checks --watch
```

Expected: CI and browser smoke checks pass; hardware jobs remain governed by the main push workflow.

- [ ] **Step 3: Squash merge after review**

Run:

```powershell
gh pr merge --squash --delete-branch
git switch main
git pull --ff-only origin main
```

Expected: PR is merged, local `main` matches `origin/main`, and the feature branch is removed remotely.

- [ ] **Step 4: Keep the self-hosted runner online and watch the main benchmark**

Run:

```powershell
$benchmarkRunId = gh run list --workflow benchmark.yml --branch main --limit 1 --json databaseId --jq '.[0].databaseId'
gh run watch $benchmarkRunId --exit-status
```

Expected: `wasm-fp32`, `webgpu-fp16`, `webgpu-fp32`, and `responsive-screenshots` all pass.

- [ ] **Step 5: Final repository verification**

Run:

```powershell
git status --short --branch
git branch --all
```

Expected: clean `main` tracking `origin/main`; only the repository's intended long-lived branch remains.
