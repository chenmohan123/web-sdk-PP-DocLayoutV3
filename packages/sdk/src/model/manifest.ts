import { DocLayoutError } from "../errors";
import type {
  ModelBackend,
  ModelManifest,
  ModelPrecision,
  ModelVariant,
  TensorSpec
} from "../types";

export const CURRENT_SDK_VERSION = "1.0.2";

const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const MODEL_BACKENDS = new Set<ModelBackend>(["webgpu", "wasm"]);
const MODEL_PRECISIONS = new Set<ModelPrecision>(["fp32", "fp16", "int8"]);

type Semver = readonly [number, number, number, readonly (number | string)[]];

export function parseModelManifest(value: unknown): ModelManifest {
  const manifest = expectRecord(value, "manifest");

  if (manifest.schemaVersion !== 1) {
    invalid("schemaVersion", "must be the supported version 1");
  }

  const minSdkVersion = expectString(manifest.minSdkVersion, "minSdkVersion");
  const parsedMinimum = parseVersion(minSdkVersion, "minSdkVersion");
  const parsedCurrent = parseVersion(CURRENT_SDK_VERSION, "currentSdkVersion");
  if (compareVersions(parsedCurrent, parsedMinimum) < 0) {
    throw new DocLayoutError(
      "MODEL_INCOMPATIBLE",
      `Model requires SDK ${minSdkVersion} or newer; current SDK is ${CURRENT_SDK_VERSION}`,
      { currentSdkVersion: CURRENT_SDK_VERSION, minSdkVersion }
    );
  }

  validateModel(manifest.model);
  validateTensor(manifest.input, "input");
  validateOutputs(manifest.outputs);
  validateLabels(manifest.labels);
  validatePreprocessing(manifest.preprocessing);
  validateSource(manifest.source);
  const variants = validateVariants(manifest.variants);
  validateVariantPriority(manifest.variantPriority, variants);

  return value as ModelManifest;
}

function validateModel(value: unknown): void {
  const model = expectRecord(value, "model");
  expectString(model.architecture, "model.architecture");
  expectString(model.id, "model.id");
  expectString(model.modelType, "model.modelType");
  expectPositiveInteger(model.parameterCount, "model.parameterCount");
  parseVersion(expectString(model.version, "model.version"), "model.version");
}

function validateTensor(value: unknown, path: string): TensorSpec {
  const tensor = expectRecord(value, path);
  if (tensor.dtype !== "float32") {
    invalid(`${path}.dtype`, 'must be "float32"');
  }
  expectString(tensor.name, `${path}.name`);
  validateShape(tensor.shape, `${path}.shape`);
  return value as TensorSpec;
}

function validateOutputs(value: unknown): void {
  const outputs = expectArray(value, "outputs");
  if (outputs.length !== 4) {
    invalid("outputs", "must contain exactly four model outputs");
  }

  const names = new Set<string>();
  outputs.forEach((output, index) => {
    const tensor = validateTensor(output, `outputs[${index}]`);
    if (names.has(tensor.name)) {
      invalid(`outputs[${index}].name`, "must be unique");
    }
    names.add(tensor.name);
  });
}

function validateShape(value: unknown, path: string): void {
  const shape = expectArray(value, path);
  if (shape.length === 0) {
    invalid(path, "must contain at least one dimension");
  }
  shape.forEach((dimension, index) => expectPositiveInteger(dimension, `${path}[${index}]`));
}

function validateLabels(value: unknown): void {
  const labels = expectArray(value, "labels");
  if (labels.length === 0) {
    invalid("labels", "must contain at least one label");
  }
  labels.forEach((label, index) => expectString(label, `labels[${index}]`));
}

function validatePreprocessing(value: unknown): void {
  const preprocessing = expectRecord(value, "preprocessing");
  expectBoolean(preprocessing.doNormalize, "preprocessing.doNormalize");
  expectBoolean(preprocessing.doRescale, "preprocessing.doRescale");
  expectBoolean(preprocessing.doResize, "preprocessing.doResize");
  expectNumberTuple(preprocessing.imageMean, "preprocessing.imageMean", false);
  expectNumberTuple(preprocessing.imageStd, "preprocessing.imageStd", true);
  expectNonNegativeInteger(preprocessing.resample, "preprocessing.resample");
  expectPositiveNumber(preprocessing.rescaleFactor, "preprocessing.rescaleFactor");

  const size = expectRecord(preprocessing.size, "preprocessing.size");
  expectPositiveInteger(size.height, "preprocessing.size.height");
  expectPositiveInteger(size.width, "preprocessing.size.width");
}

function validateSource(value: unknown): void {
  const source = expectRecord(value, "source");
  const files = expectRecord(source.files, "source.files");
  const entries = Object.entries(files);
  if (entries.length === 0) {
    invalid("source.files", "must contain at least one source file digest");
  }
  for (const [filename, sha256] of entries) {
    expectString(filename, "source.files filename");
    expectSha256(sha256, `source.files.${filename}`);
  }
  expectString(source.license, "source.license");
  expectString(source.name, "source.name");
  expectHttpUrl(source.url, "source.url");
}

function validateVariants(value: unknown): readonly ModelVariant[] {
  const variants = expectArray(value, "variants");
  if (variants.length === 0) {
    invalid("variants", "must contain at least one model variant");
  }

  const ids = new Set<string>();
  const coverage = new Set<string>();
  return variants.map((variant, index) => {
    const path = `variants[${index}]`;
    const parsed = expectRecord(variant, path);
    const id = expectString(parsed.id, `${path}.id`);
    if (ids.has(id)) {
      invalid(`${path}.id`, "must be unique");
    }
    ids.add(id);

    const precision = expectEnum(parsed.precision, `${path}.precision`, MODEL_PRECISIONS);
    const backends = expectArray(parsed.backendCompatibility, `${path}.backendCompatibility`);
    if (backends.length === 0) {
      invalid(`${path}.backendCompatibility`, "must contain at least one backend");
    }
    const variantBackends = new Set<ModelBackend>();
    backends.forEach((backend, backendIndex) => {
      const parsedBackend = expectEnum(
        backend,
        `${path}.backendCompatibility[${backendIndex}]`,
        MODEL_BACKENDS
      );
      const pair = `${precision}:${parsedBackend}`;
      if (variantBackends.has(parsedBackend) || coverage.has(pair)) {
        invalid(path, `duplicates precision ${precision} and backend ${parsedBackend} coverage`);
      }
      variantBackends.add(parsedBackend);
      coverage.add(pair);
    });

    expectPositiveInteger(parsed.bytes, `${path}.bytes`);
    expectString(parsed.filename, `${path}.filename`);
    expectPositiveInteger(parsed.opset, `${path}.opset`);
    expectSha256(parsed.sha256, `${path}.sha256`);
    expectHttpUrl(parsed.url, `${path}.url`);
    validateVariantValidation(parsed.validation, `${path}.validation`);
    return variant as ModelVariant;
  });
}

function validateVariantValidation(value: unknown, path: string): void {
  const validation = expectRecord(value, path);
  expectBoolean(validation.included, `${path}.included`);
  expectBoolean(validation.pass, `${path}.pass`);
  expectString(validation.report, `${path}.report`);
}

function validateVariantPriority(value: unknown, variants: readonly ModelVariant[]): void {
  const priority = expectArray(value, "variantPriority");
  if (priority.length !== variants.length) {
    invalid("variantPriority", "must list every model variant exactly once");
  }

  const variantIds = new Set(variants.map((variant) => variant.id));
  const priorityIds = new Set<string>();
  priority.forEach((id, index) => {
    const parsedId = expectString(id, `variantPriority[${index}]`);
    if (!variantIds.has(parsedId) || priorityIds.has(parsedId)) {
      invalid(`variantPriority[${index}]`, "must identify a unique declared model variant");
    }
    priorityIds.add(parsedId);
  });
}

function expectRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(path, "must be an object");
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    invalid(path, "must be a plain object");
  }
  return value as Record<string, unknown>;
}

function expectArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    invalid(path, "must be an array");
  }
  return value;
}

function expectString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    invalid(path, "must be a non-empty string without surrounding whitespace");
  }
  return value;
}

function expectBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    invalid(path, "must be a boolean");
  }
  return value;
}

function expectPositiveInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    invalid(path, "must be a positive safe integer");
  }
  return value;
}

function expectNonNegativeInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    invalid(path, "must be a non-negative safe integer");
  }
  return value;
}

function expectPositiveNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    invalid(path, "must be a positive finite number");
  }
  return value;
}

function expectNumberTuple(value: unknown, path: string, nonZero: boolean): void {
  const numbers = expectArray(value, path);
  if (numbers.length !== 3) {
    invalid(path, "must contain exactly three numbers");
  }
  numbers.forEach((number, index) => {
    if (typeof number !== "number" || !Number.isFinite(number) || (nonZero && number === 0)) {
      invalid(`${path}[${index}]`, `must be a finite${nonZero ? " non-zero" : ""} number`);
    }
  });
}

function expectSha256(value: unknown, path: string): string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    invalid(path, "must be a 64-character hexadecimal SHA-256 digest");
  }
  return value;
}

function expectHttpUrl(value: unknown, path: string): string {
  const url = expectString(value, path);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    invalid(path, "must be a valid HTTP(S) URL");
  }
  if (
    (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
    parsed.username ||
    parsed.password
  ) {
    invalid(path, "must be a safe HTTP(S) URL without credentials");
  }
  return url;
}

function expectEnum<T extends string>(value: unknown, path: string, values: ReadonlySet<T>): T {
  if (typeof value !== "string" || !values.has(value as T)) {
    invalid(path, `must be one of ${[...values].join(", ")}`);
  }
  return value as T;
}

function parseVersion(value: string, path: string): Semver {
  const match = VERSION_PATTERN.exec(value);
  if (match === null) {
    invalid(path, "must be a valid semantic version");
  }
  const prerelease = match[4]?.split(".").map((identifier) => {
    if (/^\d+$/.test(identifier)) {
      if (identifier.length > 1 && identifier.startsWith("0")) {
        invalid(path, "must be a valid semantic version");
      }
      return Number(identifier);
    }
    return identifier;
  });
  return [Number(match[1]), Number(match[2]), Number(match[3]), prerelease ?? []];
}

function compareVersions(left: Semver, right: Semver): number {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) {
      return left[index]! < right[index]! ? -1 : 1;
    }
  }

  const leftPrerelease = left[3];
  const rightPrerelease = right[3];
  if (leftPrerelease.length === 0 || rightPrerelease.length === 0) {
    return leftPrerelease.length === rightPrerelease.length
      ? 0
      : leftPrerelease.length === 0
        ? 1
        : -1;
  }

  for (let index = 0; index < Math.max(leftPrerelease.length, rightPrerelease.length); index += 1) {
    const leftIdentifier = leftPrerelease[index];
    const rightIdentifier = rightPrerelease[index];
    if (leftIdentifier === undefined || rightIdentifier === undefined) {
      return leftIdentifier === rightIdentifier ? 0 : leftIdentifier === undefined ? -1 : 1;
    }
    if (leftIdentifier === rightIdentifier) {
      continue;
    }
    if (typeof leftIdentifier === "number" && typeof rightIdentifier === "string") {
      return -1;
    }
    if (typeof leftIdentifier === "string" && typeof rightIdentifier === "number") {
      return 1;
    }
    return leftIdentifier < rightIdentifier ? -1 : 1;
  }
  return 0;
}

function invalid(path: string, message: string): never {
  throw new DocLayoutError("MANIFEST_INVALID", `Invalid model manifest: ${path} ${message}`, {
    path
  });
}
