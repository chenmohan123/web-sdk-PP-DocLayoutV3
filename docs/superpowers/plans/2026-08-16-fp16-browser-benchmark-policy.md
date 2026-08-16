# FP16 Browser Benchmark Policy Implementation Plan

**Goal:** Keep strict FP32 equality while validating WebGPU FP16 with a calibrated seven-fixture quality policy and auditable failure evidence.

## Task 1: Policy Module and Tests

- [x] Add `tests/browser/benchmark-parity.ts` with separate FP32/FP16 evaluators.
- [x] Keep FP32 count, label, reading-order, box, polygon, and score thresholds unchanged.
- [x] Match FP16 detections by same label and maximum spatial IoU.
- [x] Require FP16 minimum IoU `0.80`, P05 IoU `0.85`, mean IoU `0.94`, and complete matching.
- [x] Require score delta `0.02`, order displacement `1`, inversion rate `0.001`, and polygon edge distance `2 px`.
- [x] Add candidate polygon containment validation with a `2 px` tolerance.
- [x] Add tests for accepted quantization, IoU rejection, score rejection, vertex-count changes, polygon drift, local reorder, and broad reorder.
- [x] Reject empty polygons and non-finite detection values before numeric matching; define empty-set parity explicitly.

## Task 2: Benchmark Integration

- [x] Return accepted and candidate detections from the browser page for Node-side policy evaluation.
- [x] Write `test-results/benchmark/<mode>.json` before parity assertions.
- [x] Keep runtime, model hash, adapter, fallback, timing, and table reference evidence.
- [x] Upload all three benchmark reports with `if: always()` and `if-no-files-found: warn`.
- [x] Extend `scripts/benchmark-contract.test.mjs` to pin the new FP16 policy names and thresholds.
- [x] Run the focused parity suite from root `verify` and the benchmark workflow, including policy-file trigger paths.

## Task 3: Documentation and Verification

- [x] Update this plan and the policy design with the calibrated thresholds and baseline polygon finding.
- [x] Run focused parity tests and the benchmark contract.
- [x] Run scoped formatting, lint, typecheck, SDK/example/demo tests, and build.
- [x] Run physical WebGPU FP16 and WebGPU FP32 benchmarks on `windows-nvidia-webgpu`.
- [x] Confirm the final working tree and diff are scoped before committing.

## Task 4: Delivery

- [x] Commit the policy, tests, contract, and documentation changes.
- [ ] Push `codex/fp16-benchmark-policy` and create a PR against `main`.
- [ ] Require CI and the main-branch hardware benchmark to pass before squash merging.

No npm version, model release, SDK release, or GitHub Release is required; this is a benchmark validation-policy change.
