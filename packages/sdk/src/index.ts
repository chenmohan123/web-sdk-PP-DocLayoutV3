import { DocLayoutError } from "./errors";

export { DocLayoutError } from "./errors";
export type { DocLayoutErrorCode } from "./errors";
export { CURRENT_SDK_VERSION, parseModelManifest } from "./model/manifest";
export type {
  ModelBackend,
  ModelManifest,
  ModelMetadata,
  ModelPrecision,
  ModelSource,
  ModelVariant,
  ModelVariantValidation,
  PreprocessingConfig,
  TensorDataType,
  TensorSpec
} from "./types";

export function createDocLayout(): Promise<never> {
  return Promise.reject(
    new DocLayoutError("SESSION_CREATE_FAILED", "SDK implementation is not initialized")
  );
}
