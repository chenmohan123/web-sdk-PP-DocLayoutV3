# PP-DocLayoutV3 Responsive Bilingual Demo

## Scope

Build `apps/demo` as the first usable screen for the SDK. The default language is Simplified Chinese, with an English toggle. The demo loads the public SDK API, accepts one image, runs layout detection, and exposes the runtime choices and measured result details needed to evaluate CPU/GPU and FP32/FP16 behavior.

## Information Architecture

- A compact control band contains language, backend, precision, threshold, image selection, run/cancel, cache clear, and JSON export actions.
- The main content uses a two-column desktop layout: a large unframed result canvas on the left and detections/performance/model details on the right.
- At narrow widths the order is controls, image, detections, then performance/model information. No panel uses hero-scale typography or marketing copy.

## Runtime And State

The demo calls `createDocLayout` and `detector.detect` through public exports only. Backend values are `auto`, `webgpu`, and `wasm`; precision values are `auto`, `fp16`, and `fp32`. Progress events are rendered as loading state, cancellation uses `AbortController`, structured `DocLayoutError` values are shown without exposing document pixels, and detector instances are disposed on replacement/unmount.

The selected image is decoded for display and passed to the SDK. Detection coordinates are original-image coordinates. The canvas bitmap dimensions always equal the source image dimensions while CSS dimensions remain responsive; overlays are scaled by the canvas drawing transform, never by mutating detection coordinates.

## Visual Contract

Use a quiet operational palette with restrained borders, compact spacing, segmented controls, and Lucide icons for icon actions. The canvas must contain visible source-image and overlay pixels after a successful run. Layout must remain readable at 390x844, 768x1024, 1440x900, and 1920x1080 without overlap or clipped controls.

## Verification

Playwright tests cover Chinese default, English switch, backend/precision controls, progress and cancellation, one-image selection, result overlay, box/polygon toggle, threshold, timings, model metadata, fallback/error detail, JSON export, cache clear, custom manifest validation, and responsive stacking. The package must pass `pnpm --filter demo test` and `pnpm --filter demo build`.
