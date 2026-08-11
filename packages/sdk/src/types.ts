export type ModelBackend = "webgpu" | "wasm";

export type ModelPrecision = "fp32" | "fp16" | "int8";

export type TensorDataType = "float32";

export interface DocLayoutCapabilities {
  readonly crossOriginIsolated: boolean;
  readonly diagnostics: readonly string[];
  readonly wasm: boolean;
  readonly wasmSimd: boolean;
  readonly wasmThreads: boolean;
  readonly webgpu: boolean;
  readonly webgpuFp16: boolean;
  readonly worker: boolean;
}

export interface DocLayoutCapabilities {
  readonly crossOriginIsolated: boolean;
  readonly diagnostics: readonly string[];
  readonly wasm: boolean;
  readonly wasmSimd: boolean;
  readonly wasmThreads: boolean;
  readonly webgpu: boolean;
  readonly webgpuFp16: boolean;
  readonly worker: boolean;
}

export interface TensorSpec {
  readonly dtype: TensorDataType;
  readonly name: string;
  readonly shape: readonly number[];
}

export interface ModelMetadata {
  readonly architecture: string;
  readonly id: string;
  readonly modelType: string;
  readonly parameterCount: number;
  readonly version: string;
}

export interface PreprocessingConfig {
  readonly doNormalize: boolean;
  readonly doRescale: boolean;
  readonly doResize: boolean;
  readonly imageMean: readonly [number, number, number];
  readonly imageStd: readonly [number, number, number];
  readonly resample: number;
  readonly rescaleFactor: number;
  readonly size: Readonly<{
    height: number;
    width: number;
  }>;
}

export interface ModelSource {
  readonly files: Readonly<Record<string, string>>;
  readonly license: string;
  readonly name: string;
  readonly url: string;
}

export interface ModelVariantValidation {
  readonly included: boolean;
  readonly pass: boolean;
  readonly report: string;
}

export interface ModelVariant {
  readonly backendCompatibility: readonly ModelBackend[];
  readonly bytes: number;
  readonly filename: string;
  readonly id: string;
  readonly opset: number;
  readonly precision: ModelPrecision;
  readonly sha256: string;
  readonly url: string;
  readonly validation: ModelVariantValidation;
}

export interface ModelManifest {
  readonly input: TensorSpec;
  readonly labels: readonly string[];
  readonly minSdkVersion: string;
  readonly model: ModelMetadata;
  readonly outputs: readonly [TensorSpec, TensorSpec, TensorSpec, TensorSpec];
  readonly preprocessing: PreprocessingConfig;
  readonly schemaVersion: 1;
  readonly source: ModelSource;
  readonly variantPriority: readonly string[];
  readonly variants: readonly ModelVariant[];
}
