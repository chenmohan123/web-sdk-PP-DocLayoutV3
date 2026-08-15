import type { ModelBackend, ModelManifest } from "web-sdk-pp-doclayoutv3";

export type BackendPreference = "auto" | ModelBackend;
export type PrecisionPreference = "auto" | "fp16" | "fp32";

const DEFAULT_SUPPORT = {
  webgpu: ["fp16", "fp32"],
  wasm: ["fp32"]
} as const;

export function allowFallbackForSelection(
  backend: BackendPreference,
  precision: PrecisionPreference
): boolean {
  return backend === "auto" && precision === "auto";
}

export function supportsCombination(
  backend: ModelBackend,
  precision: Exclude<PrecisionPreference, "auto">,
  manifest?: ModelManifest
): boolean {
  if (manifest === undefined) {
    return (DEFAULT_SUPPORT[backend] as readonly string[]).includes(precision);
  }
  return manifest.variants.some(
    (variant) =>
      variant.precision === precision &&
      variant.backendCompatibility.includes(backend) &&
      variant.validation.included &&
      variant.validation.pass
  );
}

export function precisionForBackend(
  backend: BackendPreference,
  precision: PrecisionPreference,
  manifest?: ModelManifest
): PrecisionPreference {
  if (
    backend === "auto" ||
    precision === "auto" ||
    supportsCombination(backend, precision, manifest)
  ) {
    return precision;
  }
  return (
    (["fp16", "fp32"] as const).find((candidate) =>
      supportsCombination(backend, candidate, manifest)
    ) ?? "auto"
  );
}
