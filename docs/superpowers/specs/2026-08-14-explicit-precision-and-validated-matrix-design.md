# Explicit Precision and Validated Matrix Design

## Problem

The live Demo accepts an explicit `GPU + FP32` selection but always passes `allowFallback: true` to the SDK. On the reproduced environment, the WebGPU FP32 session fails during creation and the SDK silently continues with WebGPU FP16. The controls still show the requested pair while the result correctly reports the actual FP16 runtime, which makes the explicit selection appear ignored.

The published support matrix also exceeds its evidence. Browser and benchmark evidence covers WebGPU FP16 and WASM FP32. FP32 parity was validated with native CPU ONNX Runtime and exercised through browser WASM, but no physical WebGPU FP32 run is recorded. The default manifest nevertheless declares FP32 compatible with both WebGPU and WASM.

## Validated Default Matrix

The default model will advertise only combinations backed by browser execution evidence:

| Backend | FP16 | FP32 |
| --- | --- | --- |
| WebGPU | Supported | Not validated |
| WASM/CPU | Unsupported | Supported |

The FP32 variant remains distributed and unchanged, but its default manifest `backendCompatibility` becomes `['wasm']`. The SDK remains generic: a custom manifest may still declare a separately validated WebGPU FP32 or WASM FP16 variant.

## Selection Semantics

The Demo will make automatic and manual intent explicit:

- `Auto + Auto` enables runtime fallback.
- Any manual backend or precision choice disables runtime fallback.
- A manual pair must either identify a validated manifest combination or be blocked before detection.
- Session creation failure for a manual choice is shown as an error and never changes backend or precision.
- Automatic mode may fall back only through candidates declared valid by the active manifest.

The Demo will pass the computed `allowFallback` value explicitly so this behavior is testable and does not depend on an implicit SDK default.

## Demo Interaction

Combination availability is derived from the active model support matrix. For the default model, the Demo uses the validated matrix above. For a custom manifest, it uses included, passing variants and their `backendCompatibility` values.

- In GPU mode, FP32 is disabled unless the active manifest validates WebGPU FP32.
- In CPU mode, FP16 is disabled unless the active manifest validates WASM FP16.
- Switching backend while an incompatible precision is selected changes to that backend's validated precision and shows a notice.
- The controls continue to distinguish requested settings from the result's actual runtime information.

The existing CPU notice remains. A matching GPU notice explains that the default GPU model is validated for FP16 and that FP32 remains available through CPU/WASM.

## Errors and Fallback History

Fallback rows will include the most specific available cause text in addition to provider, precision, code, and stage. When a strict manual request fails, the main error message will include `DocLayoutError.details.causeMessage` when present. This exposes the ONNX Runtime or adapter reason without changing the public SDK error or fallback types.

## Documentation

Update the same default support matrix and selection rules in:

- root Chinese README;
- packaged bilingual SDK README;
- English and Chinese API, compatibility, conversion, and model documentation where they discuss backend coverage;
- model artifact README.

Documentation will distinguish model numerical parity from browser execution validation and will not claim WebGPU FP32 until a physical GPU run is recorded.

## Testing

Use TDD with focused regressions before implementation:

1. Manifest tests require the default FP16 variant to support only WebGPU and FP32 to support only WASM.
2. Runtime selector tests require missing `shader-f16` to continue to WASM FP32 rather than unvalidated WebGPU FP32.
3. Detector tests require automatic FP16 session failure to record a WebGPU FP16 fallback and select WASM FP32.
4. Demo tests require explicit selections to disable fallback, GPU FP32 and CPU FP16 to be disabled for the default model, backend switches to select a validated precision, and detailed runtime causes to be formatted.
5. Documentation and release contract tests keep the default matrix synchronized across manifest, SDK README, root README, and bilingual docs.
6. Run lint, typecheck, SDK tests, Demo Playwright tests, documentation tests, release tests, production build, and responsive browser checks.

## Release Impact

The model bytes and public SDK API shape do not change. GitHub Pages will publish the corrected default manifest and Demo behavior. Because the packaged SDK README and default-model behavior visible to npm consumers change, prepare a patch release after the fix passes CI; versioning and publication remain a separate explicit release step.
