# FP16 Browser Benchmark Policy Design

## Context

The seven-fixture browser benchmark compares the accepted WASM FP32 model with the requested WebGPU variant. FP32 requires near-byte-equivalent output, but that policy is too strict for FP16. Two identical NVIDIA Blackwell/Chromium runs showed stable FP16 behavior: all 155 detections were present, scores stayed within `0.02`, and the spatially matched box IoU mean was `0.971`.

The old FP16 check also compared polygon vertices by array index. That produced a false `24.16 px` failure when one contour gained a vertex and shifted all later indexes. The accepted FP32 baseline contains a separate contour point about `30 px` outside its own box, so point-index equality is not a reliable FP16 quality gate.

## Goals

- Keep the existing FP32 equality gate unchanged.
- Validate WebGPU FP16 on all seven locked fixtures with stable, explainable quality thresholds.
- Keep WebGPU, requested precision, model hash, no-fallback, adapter, and timing evidence strict.
- Preserve the complete report before Playwright parity assertions and upload it after failures.
- Cover matching, ordering, polygon, and threshold behavior with hardware-independent tests.

## Non-Goals

- Do not change SDK runtime selection, model files, manifests, Demo behavior, or public API.
- Do not weaken FP32 thresholds.
- Do not claim FP16 and FP32 are byte-identical.
- Do not publish an npm or model release for a benchmark-policy change.

## Selected Policy

FP32 continues to require equal count, label sequence, reading-order sequence, maximum box delta `1 px`, maximum polygon coordinate delta `1.5 px`, and score delta `0.001`.

FP16 uses same-label spatial assignment (Hungarian maximum-IoU matching) and requires, per fixture:

- Equal detection count and complete same-label matching.
- Minimum matched box IoU `0.80`.
- P05 matched IoU `0.85` or higher.
- Mean matched IoU `0.94` or higher.
- Maximum matched score delta `0.02`.
- Maximum reading-order displacement `1` and inversion rate at most `0.001`. This permits one adjacent swap in a 59-detection fixture while rejecting broad reordering.
- Symmetric mean point-to-edge polygon distance at most `2 px`, independent of vertex count.
- Candidate polygon points no more than `2 px` outside their candidate box.
- Reject empty polygons and non-finite label, order, score, box, or polygon values before spatial matching.
- Treat two empty detection sets as equal, while one empty side still fails count and matching checks.

The policy reports all metrics, unmatched counts, spatial reorder count, and validation errors. It does not filter matches at the IoU threshold before calculating recall; a low-IoU assignment remains visible and fails the minimum/percentile/mean gates.

## Architecture

`tests/browser/benchmark-parity.ts` is a pure TypeScript module with separate FP32 and FP16 evaluators. The Playwright page returns accepted and candidate detections; Node performs the deterministic policy evaluation after browser inference. Same-label matching is solved per label group so query-array order does not create false unmatched detections.

The benchmark writes `test-results/benchmark/<mode>.json` before parity expectations. The root `verify` command and the benchmark workflow both run the hardware-independent parity suite, and parity-module changes trigger the benchmark workflow. Every benchmark result upload in `.github/workflows/benchmark.yml` uses `if: always()` and `if-no-files-found: warn`.

## Evidence and Verification

The policy was calibrated against two identical physical WebGPU FP16 runs on NVIDIA Blackwell with Chromium 151. The low-IoU cases are concentrated in formula fixtures, while semantic counts and scores remain stable. Focused parity tests and the benchmark contract run without hardware; the physical FP16 and FP32 benchmark jobs remain required before merging.

## Delivery

Implement on `codex/fp16-benchmark-policy`, run software and physical GPU verification, then push a PR to `main`. This change does not require an npm version bump, model release, SDK release, or GitHub Release.
