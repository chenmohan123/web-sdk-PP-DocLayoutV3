# CPU Precision Compatibility Design

## Goal

Keep the SDK, Demo, and documentation aligned with the validated default model matrix: FP16 is WebGPU-only, while CPU/WASM uses FP32.

## Behavior

- With the default manifest, the SDK rejects an explicit `backend: "wasm", precision: "fp16"` request with `CAPABILITY_UNSUPPORTED`, even when fallback is enabled. Explicit combinations absent from the active manifest must not silently run a different precision; a custom manifest with a validated WASM FP16 variant remains supported.
- The Demo disables FP16 while CPU is selected for the default manifest. Switching from FP16 to CPU selects FP32 and shows a non-blocking localized notice explaining the change. A validated custom WASM FP16 variant enables the control.
- Auto mode remains unchanged: WebGPU FP16 is preferred and compatible FP32/WASM candidates remain available as runtime fallbacks.
- Documentation publishes the same backend/precision support matrix and describes the SDK error and Demo behavior.

## Testing

- Unit-test the SDK selector rejection and unchanged automatic behavior.
- Browser-test FP16-to-CPU switching, the disabled FP16 control, the localized notice, and a completed CPU/FP32 detection.
- Run documentation parity checks, type checking, linting, focused unit tests, and the focused browser test.
