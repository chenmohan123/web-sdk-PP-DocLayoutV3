import { DocLayoutError } from "../errors";
import type { DocLayoutCapabilities, ModelBackend, ModelPrecision, ModelVariant } from "../types";

export type BackendPreference = ModelBackend | "auto";
export type PrecisionPreference = ModelPrecision | "auto";

export interface ExecutionPlanOptions {
  readonly allowFallback?: boolean;
  readonly backend?: BackendPreference;
  readonly precision?: PrecisionPreference;
}

export interface ExecutionCandidate {
  readonly precision: ModelPrecision;
  readonly provider: ModelBackend;
  readonly reason: string;
  readonly status: "selected" | "skipped";
  readonly variantId: string | null;
}

export interface ExecutionPlan {
  readonly candidates: readonly ExecutionCandidate[];
  readonly selected: ExecutionCandidate & {
    readonly status: "selected";
    readonly variantId: string;
  };
}

interface CandidateDefinition {
  readonly precision: ModelPrecision;
  readonly provider: ModelBackend;
}

const AUTOMATIC_ORDER: readonly CandidateDefinition[] = [
  { provider: "webgpu", precision: "fp16" },
  { provider: "webgpu", precision: "fp32" },
  { provider: "wasm", precision: "fp16" },
  { provider: "wasm", precision: "int8" },
  { provider: "wasm", precision: "fp32" }
];

export function selectExecutionPlan(
  options: ExecutionPlanOptions,
  capabilities: DocLayoutCapabilities,
  variants: readonly ModelVariant[]
): ExecutionPlan {
  const backend = options.backend ?? "auto";
  const precision = options.precision ?? "auto";
  const hasExplicitPreference = backend !== "auto" || precision !== "auto";
  const allowFallback = options.allowFallback ?? !hasExplicitPreference;
  if (
    backend !== "auto" &&
    precision !== "auto" &&
    !variants.some(
      (variant) =>
        variant.precision === precision &&
        variant.backendCompatibility.includes(backend) &&
        variant.validation.included &&
        variant.validation.pass
    )
  ) {
    throw new DocLayoutError(
      "CAPABILITY_UNSUPPORTED",
      `No validated ${precision.toUpperCase()} variant supports ${backend.toUpperCase()}`,
      { allowFallback, backend, precision }
    );
  }
  const orderedDefinitions = orderForPreferences(backend, precision, allowFallback, variants);
  const candidates: ExecutionCandidate[] = [];
  let selected: ExecutionPlan["selected"] | undefined;

  for (const definition of orderedDefinitions) {
    const variant = variants.find(
      (item) =>
        item.precision === definition.precision &&
        item.backendCompatibility.includes(definition.provider) &&
        item.validation.included &&
        item.validation.pass
    );
    const preferenceMatch = matchesPreferences(definition, backend, precision);
    const unavailableReason = candidateUnavailableReason(definition, variant, capabilities);

    if (!preferenceMatch && !allowFallback) {
      candidates.push({
        ...definition,
        reason: "Skipped by explicit backend or precision selection with fallback disabled",
        status: "skipped",
        variantId: variant?.id ?? null
      });
    } else if (unavailableReason !== null) {
      candidates.push({
        ...definition,
        reason: unavailableReason,
        status: "skipped",
        variantId: variant?.id ?? null
      });
    } else if (selected !== undefined) {
      candidates.push({
        ...definition,
        reason: `Skipped because higher-priority variant ${selected.variantId} was selected`,
        status: "skipped",
        variantId: variant!.id
      });
    } else {
      const reason = preferenceMatch
        ? `Selected ${definition.provider.toUpperCase()} ${definition.precision.toUpperCase()}`
        : `Selected as fallback from requested backend ${backend} and precision ${precision}`;
      selected = {
        ...definition,
        reason,
        status: "selected",
        variantId: variant!.id
      };
      candidates.push(selected);
    }
  }

  if (selected === undefined) {
    throw new DocLayoutError(
      "CAPABILITY_UNSUPPORTED",
      "No compatible PP-DocLayoutV3 execution plan is available",
      { allowFallback, backend, candidates, precision }
    );
  }

  return { candidates, selected };
}

function orderForPreferences(
  backend: BackendPreference,
  precision: PrecisionPreference,
  allowFallback: boolean,
  variants: readonly ModelVariant[]
): readonly CandidateDefinition[] {
  if (backend === "auto" && precision === "auto") {
    return AUTOMATIC_ORDER;
  }
  const explicitDefinition =
    backend !== "auto" &&
    precision !== "auto" &&
    variants.some(
      (variant) =>
        variant.precision === precision &&
        variant.backendCompatibility.includes(backend) &&
        variant.validation.included &&
        variant.validation.pass
    ) &&
    !AUTOMATIC_ORDER.some(
      (candidate) => candidate.provider === backend && candidate.precision === precision
    )
      ? [{ provider: backend, precision }]
      : [];
  const availableDefinitions = [...explicitDefinition, ...AUTOMATIC_ORDER];
  const backendCandidates =
    backend === "auto"
      ? availableDefinitions
      : availableDefinitions.filter((candidate) => candidate.provider === backend);
  const preferred = backendCandidates.filter((candidate) =>
    matchesPreferences(candidate, backend, precision)
  );
  if (!allowFallback) {
    const excluded = backendCandidates.filter((candidate) => !preferred.includes(candidate));
    return [...preferred, ...excluded];
  }
  return [...preferred, ...backendCandidates.filter((candidate) => !preferred.includes(candidate))];
}

function matchesPreferences(
  candidate: CandidateDefinition,
  backend: BackendPreference,
  precision: PrecisionPreference
): boolean {
  return (
    (backend === "auto" || candidate.provider === backend) &&
    (precision === "auto" || candidate.precision === precision)
  );
}

function candidateUnavailableReason(
  candidate: CandidateDefinition,
  variant: ModelVariant | undefined,
  capabilities: DocLayoutCapabilities
): string | null {
  if (variant === undefined) {
    return `No validated ${candidate.precision.toUpperCase()} variant supports ${candidate.provider.toUpperCase()}`;
  }
  if (candidate.provider === "webgpu" && !capabilities.webgpu) {
    return "WebGPU is unavailable";
  }
  if (
    candidate.provider === "webgpu" &&
    candidate.precision === "fp16" &&
    !capabilities.webgpuFp16
  ) {
    return "WebGPU adapter does not support shader-f16";
  }
  if (candidate.provider === "wasm" && !capabilities.wasm) {
    return "WebAssembly is unavailable";
  }
  return null;
}
