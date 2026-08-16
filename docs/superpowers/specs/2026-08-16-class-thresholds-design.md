# Per-Class Detection Thresholds Design

## Goal

Allow each layout class to override the default detection confidence threshold for one `detect()` call, while preserving existing behavior for callers that only provide `threshold` or no detection options. Expose the same configuration through the Demo without crowding its primary control band.

## Public API

Extend `DocLayoutDetectOptions` with a readonly class-name map:

```ts
export interface DocLayoutDetectOptions {
  readonly classThresholds?: Readonly<Record<string, number>>;
  readonly signal?: AbortSignal;
  readonly threshold?: number;
}
```

The intended usage is:

```ts
const result = await detector.detect(image, {
  threshold: 0.5,
  classThresholds: {
    formula: 0.4,
    table: 0.55,
    text: 0.6
  }
});
```

The effective confidence threshold for a candidate is `classThresholds[label] ?? threshold ?? 0.5`. A class override applies to every label ID with that exact label name. This is intentional because the default PP-DocLayoutV3 manifest contains duplicate `formula`, `footer`, `header`, and `text` labels.

The name-based map is preferred over label-ID configuration because it matches manifest terminology, remains readable in application code, and works with custom manifests. A callback-based resolver is out of scope because functions cannot be sent through the inference Worker protocol.

## Validation And Compatibility

- Existing calls remain unchanged and continue to use a default threshold of `0.5`.
- The global threshold and every supplied class threshold must be a finite number from `0` through `1`, inclusive.
- An override whose name is absent from the active manifest labels is rejected with the existing `INFERENCE_FAILED` error family. Failing loudly prevents misspelled names from silently using the global threshold.
- Empty `classThresholds` objects are valid and behave like no overrides.
- Detection scores remain inclusive: a score equal to its effective threshold is retained.
- Label matching is exact and case-sensitive because manifest labels are exact machine-readable identifiers.

## Postprocessing Semantics

Preserve the current official global top-k behavior. Postprocessing continues to rank every query/class score globally and take the first `queries` candidates before threshold filtering. Each selected candidate is then filtered using the effective threshold for its label. Lowering a class threshold does not resurrect a candidate outside the model's existing global top-k set.

Per-class thresholds affect only detection confidence filtering. The global `threshold` continues to binarize masks and therefore continues to control polygon extraction. For example, `formula: 0.4` may retain a formula detection with score `0.45`, but its mask still uses the global threshold of `0.5`. This avoids changing polygon geometry as a side effect of tuning class recall.

Reading-order calculation, box conversion, polygon fallback, result shape, and result sorting remain unchanged.

## Data Flow

The optional map follows the same path as the existing global threshold:

1. `DocLayoutDetector.detect()` accepts `classThresholds` in the public options.
2. The detector forwards it to the selected `InferenceExecutor`.
3. Main-thread execution passes it directly to `postprocessDetections()`.
4. Worker execution structured-clones it in `WorkerDetectPayload`, then passes it to `postprocessDetections()` inside the Worker.
5. Postprocessing validates the map against the active manifest labels and resolves the effective confidence threshold for each top-k candidate.

The Worker and main-thread implementations must share the same option shape and postprocessing function so their behavior remains identical.

## Demo Interaction

Keep the existing global confidence slider as the default threshold. Add a separate collapsible class-threshold editor below the main control band so the complete category list does not make the primary controls excessively tall or wide.

- Show one numeric input per unique active label, using the manifest's technical label names.
- A blank input means that the class inherits the current global threshold.
- Accept values from `0` through `1` with a `0.05` step.
- Provide a clear-all command that removes every class override.
- Use a responsive grid that collapses to one column on narrow screens and does not introduce horizontal overflow.
- The default model uses a Demo-owned list synchronized with the pinned default manifest. The fixture model and a validated custom manifest use their own labels.
- When the active label set changes, build the outgoing map only from visible active labels so stale overrides cannot trigger unknown-label validation errors.
- Pass `classThresholds` to `detect()` only when at least one override is present.

The editor receives Chinese and English labels for its heading, inherited/default state, reset action, and accessibility names. Model class identifiers such as `formula` and `table` are not translated.

## Documentation

Document the new option and fallback rule in:

- root Chinese and English READMEs;
- the packaged SDK README;
- English and Chinese quick-start guides;
- English and Chinese API references;
- the generated API report produced by the SDK build.

Examples must state that `classThresholds` controls confidence filtering only and that the global threshold still controls mask polygon extraction.

## Testing

Implement the change with focused regressions:

1. Postprocessing tests cover per-label overrides above and below the global threshold, inclusive boundaries, fallback to the global threshold, duplicate label names, invalid numeric values, unknown labels, and unchanged mask polygons.
2. Worker bridge tests assert that `classThresholds` is structured-cloned into the detect payload together with `threshold`.
3. Detector tests assert identical option forwarding through the main-thread executor path.
4. Demo Playwright tests cover opening the editor, editing and clearing overrides, custom or fixture labels, successful detection with overrides, Chinese and English accessibility names, and mobile horizontal-overflow protection.
5. Documentation contract checks continue to enforce English and Chinese parity where applicable.
6. Run formatting, lint, typecheck, SDK tests, Demo Playwright tests, documentation tests, API extraction, and production builds before completion.

## Release Impact

This is an additive SDK API change and does not alter model files, manifests, detection result types, or default output. It should ship in a minor release under semantic versioning. Version bumps, changelog publication, and package release remain separate explicit release work.
