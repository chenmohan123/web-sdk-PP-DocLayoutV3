# FP16 Browser Benchmark Policy Design

## Context

Release benchmark run `31926383348` proved that strict WebGPU FP32 execution works on the physical NVIDIA adapter, but the WebGPU FP16 job failed after completing inference on all seven locked fixtures. A same-machine reproduction showed that detection counts, label sequences, and reading order remained stable, while six fixtures exceeded the FP32 equality thresholds.

The failure exposed a policy mismatch. The seven-fixture browser runner applies the FP32 accepted-versus-candidate thresholds to every precision:

- maximum box coordinate delta: `1 px`
- maximum polygon coordinate delta: `1.5 px`, with identical point counts
- maximum score delta: `0.001`

Those thresholds validate that the sanitized FP32 graph is effectively equivalent to the accepted FP32 graph. They are not the approved FP16 quality thresholds. FP16 was accepted with IoU `0.95`, matched detection ratio `0.99`, maximum score delta `0.02`, and mean finite polygon-point distance `2 px`.

Historical WebGPU FP16 CI passed only the single `table.png` fixture. The seven-fixture runner was added later, but its first post-change hardware execution was blocked by an offline self-hosted runner. The copied historical FP16 browser evidence therefore did not prove seven-fixture FP32-style equality.

## Goals

- Keep the existing FP32 browser equality gate unchanged.
- Validate FP16 with the existing project-approved quality policy on all seven locked fixtures.
- Preserve strict execution requirements: WebGPU, requested precision, no fallback, expected model hash, and physical adapter evidence.
- Persist useful evidence before assertions so a parity failure identifies the fixture and failed metric.
- Upload benchmark evidence even when the Playwright parity assertion fails.
- Cover the policy logic with hardware-independent tests before rerunning physical WebGPU validation.

## Non-Goals

- Do not change SDK runtime selection, model files, manifests, Demo behavior, or public documentation.
- Do not weaken FP32 thresholds.
- Do not claim that FP16 and FP32 outputs are byte-identical.
- Do not replace the accepted FP16 model or publish a new package/release as part of this fix.

## Considered Approaches

### 1. Precision-specific policies (selected)

Use FP32 equality metrics only for FP32. Use the established FP16 quality metrics for FP16, with same-label greedy IoU matching and aggregate score/polygon evidence. This preserves the purpose of each gate and makes the browser evidence consistent with model variant acceptance.

### 2. Relax the shared thresholds

Increase coordinate and score tolerances until FP16 passes. This is rejected because it would silently weaken the FP32 equivalence gate and mix two different validation claims.

### 3. Remove FP16 from the seven-fixture workflow

Continue relying on historical single-fixture/raw-output evidence. This is rejected because it leaves FP16 browser accuracy without recurring multi-fixture regression protection.

## Architecture

Create a pure TypeScript parity module under `tests/browser/` with detection types and two policy evaluators. The Playwright benchmark imports this module after browser inference returns accepted and candidate detections. This keeps GPU/session work in the page while moving policy decisions to deterministic Node code that can be tested without hardware.

The FP32 evaluator preserves the current behavior: equal detection count, equal label sequence, equal reading-order sequence, and the existing maximum coordinate/score deltas.

The FP16 evaluator mirrors the accepted variant policy:

1. Build all same-label accepted/candidate pairs with IoU at least `0.95`.
2. Greedily select the highest-IoU non-overlapping pairs.
3. Require matched detection recall and precision to be at least `0.99`.
4. Require maximum matched score delta to be at most `0.02`.
5. Calculate polygon distance for matched polygons with equal non-zero point counts, ignore non-finite comparisons as the existing Python validator does, and require the finite mean to be at most `2 px`.
6. Record detection counts, match counts, unmatched counts, score delta, polygon distance, and thresholds for each fixture.

Each fixture receives a `passed` or `failed` parity result. The overall report passes only when all seven fixtures pass and the runtime/model assertions remain satisfied.

## Evidence Flow

For each fixture, the browser returns both accepted FP32/WASM detections and target detections, along with output hashes and target timings. Node applies the selected precision policy and builds the complete report.

The report is written to `test-results/benchmark/<mode>.json` before parity expectations execute. A failing fixture therefore still leaves an auditable report with `status: "failed"` and explicit validation errors. Successful reports retain `status: "passed"`.

Every benchmark artifact upload in `.github/workflows/benchmark.yml` uses `if: always()`. Missing evidence remains visible rather than converting an inference failure into an apparently successful artifact step.

## Testing

- Add hardware-independent tests for FP32 threshold preservation.
- Add FP16 tests covering successful matching, IoU rejection, score rejection, polygon rejection, and matched-ratio rejection.
- Extend the benchmark workflow contract to require unconditional artifact upload and precision-specific policies.
- Run the focused parity tests and benchmark contract locally.
- Run the full repository verification suite.
- Run local physical `webgpu-fp16` and `webgpu-fp32` benchmarks on `windows-nvidia-webgpu`.
- After PR merge, require the `main` release benchmark workflow to pass all four jobs.

## Delivery

Implement on `codex/fp16-benchmark-policy`, push a PR to `main`, and squash merge only after local and PR checks pass. No npm version, model release, SDK release, or GitHub Release is required because this changes validation policy and diagnostics only.
