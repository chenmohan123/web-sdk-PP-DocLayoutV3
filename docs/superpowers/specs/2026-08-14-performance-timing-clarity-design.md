# Performance Timing Clarity Design

## Problem

The Demo currently renders initialization timings and per-detection timings in one flat list. Both groups contain a value labelled as a total, so users can reasonably assume that the detection total belongs to the initialization breakdown or that every visible number should add up to one total.

## Selected Design

Keep the existing single collapsible `Performance` section and divide its contents into two labelled groups:

1. `Initialization`
2. `Current detection`

This preserves the compact right-hand panel while making the two timing scopes explicit.

### Initialization Group

Display these fields in this order:

- Initialization total
- Model download
- Cache read
- Integrity check
- Model source
- Session creation

`Initialization total` remains backed by `detector.loadTimings.totalMs`. Its child metrics are diagnostic phase measurements and do not need to add up exactly to the wall-clock total.

### Current Detection Group

Display these fields in this order:

- End-to-end time
- Image decode
- Preprocessing
- Model inference
- Postprocessing

`End-to-end time` remains backed by `result.timings.totalMs`. The four phase values remain backed by their existing fields. A short note below the group explains that the end-to-end value also includes small amounts of Worker communication and result-transfer overhead.

## Visual Treatment

- Group labels use small, subdued text to provide hierarchy without introducing nested cards.
- Each group's total row uses stronger text and a divider so it is visually distinct from phase metrics.
- The explanatory note uses compact secondary text and remains inside the performance section.
- No new card, modal, tooltip, or computed overhead row is added.

## Copy

Chinese:

- `初始化`
- `本次检测`
- `初始化总耗时`
- `端到端耗时`
- `图片解码`
- `模型推理`
- `端到端耗时还包含 Worker 通信与结果传输等少量开销。`

English:

- `Initialization`
- `Current detection`
- `Initialization total`
- `End-to-end time`
- `Image decode`
- `Model inference`
- `End-to-end time also includes small Worker communication and result-transfer overhead.`

## Documentation

Update the Chinese and English performance documentation to distinguish `detector.loadTimings.totalMs` from `result.timings.totalMs`, list the fields covered by each scope, and explain why the detection phase values may not exactly sum to the end-to-end duration.

## Testing

The Demo browser test will verify:

- Both timing group labels are present.
- Initialization appears before current detection.
- `loadTimings.totalMs` remains in the initialization group.
- `result.timings.totalMs` remains in the current-detection group.
- The end-to-end overhead explanation is visible after a completed detection.
- Existing responsive and horizontal-overflow tests continue to pass.

Type checking, linting, the Demo production build, and SDK unit tests remain part of final verification.
