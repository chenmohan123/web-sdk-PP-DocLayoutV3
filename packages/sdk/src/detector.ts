import type { ModelCacheEntry } from "./cache/model-cache";
import { MemoryModelCache } from "./cache/memory-cache";
import { DocLayoutError, type DocLayoutErrorCode } from "./errors";
import { decodeImage, type DecodableImage } from "./image/decode";
import { parseModelManifest } from "./model/manifest";
import { ModelManager, type LoadedModel, type ModelLoadOptions } from "./model/model-manager";
import { verifyModelIntegrity } from "./model/integrity";
import { postprocessDetections, type LayoutDetection } from "./postprocess";
import { preprocessRaster } from "./preprocess";
import { probeCapabilities, type CapabilityProbeOptions } from "./runtime/capabilities";
import { createOrtSession, type OrtWasmOptions } from "./runtime/ort-session";
import {
  selectExecutionPlan,
  type BackendPreference,
  type ExecutionCandidate,
  type PrecisionPreference
} from "./runtime/select-plan";
import type {
  DocLayoutCapabilities,
  ModelBackend,
  ModelManifest,
  ModelPrecision,
  ModelVariant,
  NormalizedRaster
} from "./types";
import { createWorkerBridge, type InferenceExecutor } from "./worker/worker-bridge";
import type { WorkerProgress } from "./worker/protocol";

export const DEFAULT_MANIFEST_URL =
  "https://chenmohan123.github.io/web-sdk-PP-DocLayoutV3/models/v1.0.1/manifest.json";

export const DEFAULT_ORT_WASM_BASE_URL =
  "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/";

export type DocLayoutModel =
  string | ModelManifest | Readonly<{ data: ArrayBuffer; manifest: ModelManifest }>;

export interface DocLayoutOrtOptions {
  readonly wasm?: OrtWasmOptions;
}

export type DocLayoutProgressPhase =
  | "capabilities"
  | "manifest"
  | "model"
  | "session"
  | "fallback"
  | "ready"
  | "preprocess"
  | "inference"
  | "postprocess";

export interface DocLayoutProgressEvent {
  readonly phase: DocLayoutProgressPhase;
  readonly status: "start" | "progress" | "complete";
  readonly loadedBytes?: number;
  readonly totalBytes?: number;
  readonly fallback?: DocLayoutFallback;
  readonly requestId?: number;
}

export interface CreateDocLayoutOptions {
  readonly allowFallback?: boolean;
  readonly backend?: BackendPreference;
  readonly cache?: boolean;
  readonly model?: DocLayoutModel;
  readonly onProgress?: (event: DocLayoutProgressEvent) => void;
  readonly ort?: DocLayoutOrtOptions;
  readonly precision?: PrecisionPreference;
  readonly signal?: AbortSignal;
}

export interface DocLayoutDetectOptions {
  readonly signal?: AbortSignal;
  readonly threshold?: number;
}

export interface DocLayoutFallback {
  readonly cause: unknown;
  readonly code: DocLayoutErrorCode;
  readonly message: string;
  readonly precision: ModelPrecision;
  readonly provider: ModelBackend;
  readonly stage: string;
  readonly variantId: string;
}

export interface DocLayoutRuntimeInfo {
  readonly backend: ModelBackend;
  readonly capabilities: DocLayoutCapabilities;
  readonly fallbacks: readonly DocLayoutFallback[];
  readonly mode: "main" | "worker";
  readonly precision: ModelPrecision;
}

export interface DocLayoutModelInfo {
  readonly architecture: string;
  readonly bytes: number;
  readonly id: string;
  readonly input: ModelManifest["input"];
  readonly opset: number;
  readonly outputs: ModelManifest["outputs"];
  readonly parameterCount: number;
  readonly precision: ModelPrecision;
  readonly sha256: string;
  readonly source: ModelManifest["source"];
  readonly variantId: string;
  readonly version: string;
}

export interface DocLayoutLoadTimings {
  readonly capabilitiesMs: number;
  readonly integrityMs: number;
  readonly manifestMs: number;
  readonly modelCacheMs: number;
  readonly modelDownloadMs: number;
  readonly modelMs: number;
  readonly modelSource: "cache" | "custom" | "memory" | "network";
  readonly sessionMs: number;
  readonly totalMs: number;
}

export interface DocLayoutResult {
  readonly detections: readonly LayoutDetection[];
  readonly image: Readonly<{
    input: Readonly<{ height: number; width: number }>;
    original: Readonly<{ height: number; width: number }>;
  }>;
  readonly model: DocLayoutModelInfo;
  readonly runtime: DocLayoutRuntimeInfo;
  readonly timings: Readonly<{
    decodeMs: number;
    inferenceMs: number;
    postprocessMs: number;
    preprocessMs: number;
    totalMs: number;
  }>;
}

export interface DocLayoutDetector {
  readonly capabilities: DocLayoutCapabilities;
  readonly loadTimings: DocLayoutLoadTimings;
  readonly model: DocLayoutModelInfo;
  readonly runtime: DocLayoutRuntimeInfo;
  clearModelCache(): Promise<void>;
  detect(image: DecodableImage, options?: DocLayoutDetectOptions): Promise<DocLayoutResult>;
  dispose(): Promise<void>;
  listModelCache(): Promise<readonly ModelCacheEntry[]>;
}

export interface DetectorModelManager {
  clearCache(): Promise<void>;
  listCache(): Promise<readonly ModelCacheEntry[]>;
  load(
    manifest: ModelManifest,
    variant: ModelVariant,
    options?: ModelLoadOptions
  ): Promise<LoadedModel>;
}

export interface CreateDetectorExecutorOptions {
  readonly capabilities: DocLayoutCapabilities;
  readonly manifest: ModelManifest;
  readonly modelBytes: ArrayBuffer;
  readonly onProgress?: (progress: WorkerProgress) => void;
  readonly provider: ModelBackend;
  readonly variant: ModelVariant;
  readonly wasm?: OrtWasmOptions;
}

export interface DetectorDependencies {
  readonly createExecutor: (options: CreateDetectorExecutorOptions) => Promise<InferenceExecutor>;
  readonly decodeImage: (image: DecodableImage, signal?: AbortSignal) => Promise<NormalizedRaster>;
  readonly fetchManifest: (url: string, signal?: AbortSignal) => Promise<ModelManifest>;
  readonly modelManager: DetectorModelManager;
  readonly now: () => number;
  readonly probeCapabilities: (signal?: AbortSignal) => Promise<DocLayoutCapabilities>;
  readonly verifyModel: (data: ArrayBuffer, variant: ModelVariant) => Promise<void>;
}

interface ResolvedModel {
  readonly data?: ArrayBuffer;
  readonly manifest: ModelManifest;
}

interface AttemptResult {
  readonly candidate: ExecutionCandidate & { variantId: string };
  readonly executor: InferenceExecutor;
  readonly integrityMs: number;
  readonly loaded: LoadedModel;
  readonly modelCacheMs: number;
  readonly modelDownloadMs: number;
  readonly modelMs: number;
  readonly modelSource: "cache" | "custom" | "memory" | "network";
  readonly sessionMs: number;
  readonly variant: ModelVariant;
}

function nowDefault(): number {
  return typeof performance === "object" ? performance.now() : Date.now();
}

function abortError(signal: AbortSignal): DocLayoutError {
  return new DocLayoutError("ABORTED", "PP-DocLayoutV3 operation was aborted", {
    reason: signal.reason ?? "aborted"
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw abortError(signal);
}

function elapsed(now: () => number, startedAt: number): number {
  return Math.max(0, now() - startedAt);
}

function errorCode(error: unknown): DocLayoutErrorCode {
  return error instanceof DocLayoutError ? error.code : "SESSION_CREATE_FAILED";
}

function fallbackFrom(
  candidate: ExecutionCandidate & { variantId: string },
  error: unknown
): DocLayoutFallback {
  return {
    cause: error instanceof Error ? (error.cause ?? error) : error,
    code: errorCode(error),
    message: error instanceof Error ? error.message : String(error),
    precision: candidate.precision,
    provider: candidate.provider,
    stage:
      error instanceof DocLayoutError && typeof error.details.stage === "string"
        ? error.details.stage
        : "session-create",
    variantId: candidate.variantId
  };
}

function modelInfo(manifest: ModelManifest, variant: ModelVariant): DocLayoutModelInfo {
  return {
    architecture: manifest.model.architecture,
    bytes: variant.bytes,
    id: manifest.model.id,
    input: manifest.input,
    opset: variant.opset,
    outputs: manifest.outputs,
    parameterCount: manifest.model.parameterCount,
    precision: variant.precision,
    sha256: variant.sha256,
    source: manifest.source,
    variantId: variant.id,
    version: manifest.model.version
  };
}

function eligibleAttempts(
  candidates: readonly ExecutionCandidate[]
): readonly (ExecutionCandidate & { variantId: string })[] {
  const selectedIndex = candidates.findIndex((candidate) => candidate.status === "selected");
  return candidates
    .slice(selectedIndex)
    .filter(
      (candidate): candidate is ExecutionCandidate & { variantId: string } =>
        candidate.variantId !== null &&
        (candidate.status === "selected" ||
          candidate.reason.startsWith("Skipped because higher-priority"))
    );
}

async function resolveModel(
  model: DocLayoutModel | undefined,
  signal: AbortSignal | undefined,
  dependencies: DetectorDependencies
): Promise<ResolvedModel> {
  if (model === undefined || typeof model === "string") {
    return {
      manifest: await dependencies.fetchManifest(model ?? DEFAULT_MANIFEST_URL, signal)
    };
  }
  if ("manifest" in model && "data" in model) {
    return { data: model.data, manifest: parseModelManifest(model.manifest) };
  }
  return { manifest: parseModelManifest(model) };
}

async function attemptExecutor(
  candidates: readonly (ExecutionCandidate & { variantId: string })[],
  resolved: ResolvedModel,
  capabilities: DocLayoutCapabilities,
  options: CreateDocLayoutOptions,
  dependencies: DetectorDependencies,
  fallbacks: DocLayoutFallback[]
): Promise<AttemptResult> {
  let lastError: unknown;
  let integrityMs = 0;
  let modelCacheMs = 0;
  let modelDownloadMs = 0;
  let modelMs = 0;
  let sessionMs = 0;
  for (const [index, candidate] of candidates.entries()) {
    const variant = resolved.manifest.variants.find((item) => item.id === candidate.variantId)!;
    try {
      options.onProgress?.({ phase: "model", status: "start" });
      let loaded: LoadedModel;
      const modelStartedAt = dependencies.now();
      try {
        if (resolved.data === undefined) {
          loaded = await dependencies.modelManager.load(resolved.manifest, variant, {
            onProgress: (progress) =>
              options.onProgress?.({ phase: "model", status: "progress", ...progress }),
            ...(options.signal === undefined ? {} : { signal: options.signal })
          });
        } else {
          const integrityStartedAt = dependencies.now();
          await dependencies.verifyModel(resolved.data, variant);
          loaded = {
            data: resolved.data,
            downloadedBytes: 0,
            integrityMs: elapsed(dependencies.now, integrityStartedAt),
            modelCacheMs: 0,
            modelDownloadMs: 0,
            modelSource: "custom",
            source: "cache"
          };
        }
      } finally {
        modelMs += elapsed(dependencies.now, modelStartedAt);
      }
      integrityMs += loaded.integrityMs;
      modelCacheMs += loaded.modelCacheMs;
      modelDownloadMs += loaded.modelDownloadMs;
      options.onProgress?.({ phase: "model", status: "complete" });
      options.onProgress?.({ phase: "session", status: "start" });
      const sessionStartedAt = dependencies.now();
      let executor: InferenceExecutor;
      try {
        const wasm = {
          paths: DEFAULT_ORT_WASM_BASE_URL,
          ...options.ort?.wasm
        };
        executor = await dependencies.createExecutor({
          capabilities,
          manifest: resolved.manifest,
          modelBytes: loaded.data,
          onProgress: (progress) => options.onProgress?.(progress),
          provider: candidate.provider,
          variant,
          wasm
        });
      } finally {
        sessionMs += elapsed(dependencies.now, sessionStartedAt);
      }
      options.onProgress?.({ phase: "session", status: "complete" });
      return {
        candidate,
        executor,
        integrityMs,
        loaded,
        modelCacheMs,
        modelDownloadMs,
        modelMs,
        modelSource: loaded.modelSource,
        sessionMs,
        variant
      };
    } catch (error) {
      lastError = error;
      const fallback = fallbackFrom(candidate, error);
      const hasNext = index + 1 < candidates.length && resolved.data === undefined;
      if (!hasNext) throw error;
      fallbacks.push(fallback);
      options.onProgress?.({ fallback, phase: "fallback", status: "complete" });
    }
  }
  throw lastError;
}

class DocLayoutDetectorImplementation implements DocLayoutDetector {
  private disposed = false;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    readonly capabilities: DocLayoutCapabilities,
    readonly loadTimings: DocLayoutLoadTimings,
    readonly model: DocLayoutModelInfo,
    readonly runtime: DocLayoutRuntimeInfo,
    private readonly executor: InferenceExecutor,
    private readonly manifest: ModelManifest,
    private readonly modelManager: DetectorModelManager,
    private readonly decode: DetectorDependencies["decodeImage"],
    private readonly now: () => number
  ) {}

  clearModelCache(): Promise<void> {
    return this.modelManager.clearCache();
  }

  listModelCache(): Promise<readonly ModelCacheEntry[]> {
    return this.modelManager.listCache();
  }

  detect(image: DecodableImage, options: DocLayoutDetectOptions = {}): Promise<DocLayoutResult> {
    if (this.disposed) return Promise.reject(this.disposedError());
    const operation = this.queue.then(() => {
      if (this.disposed) throw this.disposedError();
      throwIfAborted(options.signal);
      return this.detectOnce(image, options);
    });
    this.queue = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.queue;
    await this.executor.dispose();
  }

  private async detectOnce(
    image: DecodableImage,
    options: DocLayoutDetectOptions
  ): Promise<DocLayoutResult> {
    const totalStartedAt = this.now();
    const decodeStartedAt = this.now();
    const raster = await this.decode(image, options.signal);
    const decodeMs = elapsed(this.now, decodeStartedAt);
    const inference = await this.executor.detect(raster, options);
    return {
      detections: inference.detections,
      image: {
        input: this.manifest.preprocessing.size,
        original: { height: raster.height, width: raster.width }
      },
      model: this.model,
      runtime: this.runtime,
      timings: {
        decodeMs,
        inferenceMs: inference.timings.inferenceMs,
        postprocessMs: inference.timings.postprocessMs,
        preprocessMs: inference.timings.preprocessMs,
        totalMs: elapsed(this.now, totalStartedAt)
      }
    };
  }

  private disposedError(): DocLayoutError {
    return new DocLayoutError("INFERENCE_FAILED", "DocLayout detector has been disposed", {
      disposed: true
    });
  }
}

export async function createDocLayoutWithDependencies(
  options: CreateDocLayoutOptions,
  dependencies: DetectorDependencies
): Promise<DocLayoutDetector> {
  const totalStartedAt = dependencies.now();
  throwIfAborted(options.signal);

  options.onProgress?.({ phase: "capabilities", status: "start" });
  const capabilitiesStartedAt = dependencies.now();
  const capabilities = await dependencies.probeCapabilities(options.signal);
  const capabilitiesMs = elapsed(dependencies.now, capabilitiesStartedAt);
  options.onProgress?.({ phase: "capabilities", status: "complete" });

  options.onProgress?.({ phase: "manifest", status: "start" });
  const manifestStartedAt = dependencies.now();
  const resolved = await resolveModel(options.model, options.signal, dependencies);
  const manifestMs = elapsed(dependencies.now, manifestStartedAt);
  options.onProgress?.({ phase: "manifest", status: "complete" });

  const plan = selectExecutionPlan(options, capabilities, resolved.manifest.variants);
  const candidates = eligibleAttempts(plan.candidates);
  const fallbacks: DocLayoutFallback[] = [];
  const selected = await attemptExecutor(
    candidates,
    resolved,
    capabilities,
    options,
    dependencies,
    fallbacks
  );
  const runtime: DocLayoutRuntimeInfo = {
    backend: selected.candidate.provider,
    capabilities,
    fallbacks,
    mode: selected.executor.mode,
    precision: selected.variant.precision
  };
  const info = modelInfo(resolved.manifest, selected.variant);
  const loadTimings: DocLayoutLoadTimings = {
    capabilitiesMs,
    integrityMs: selected.integrityMs,
    manifestMs,
    modelCacheMs: selected.modelCacheMs,
    modelDownloadMs: selected.modelDownloadMs,
    modelMs: selected.modelMs,
    modelSource: selected.modelSource,
    sessionMs: selected.sessionMs,
    totalMs: elapsed(dependencies.now, totalStartedAt)
  };
  options.onProgress?.({ phase: "ready", status: "complete" });
  return new DocLayoutDetectorImplementation(
    capabilities,
    loadTimings,
    info,
    runtime,
    selected.executor,
    resolved.manifest,
    dependencies.modelManager,
    dependencies.decodeImage,
    dependencies.now
  );
}

function defaultDependencies(cache = true): DetectorDependencies {
  const modelManager = cache
    ? new ModelManager()
    : new ModelManager({ memoryCache: new MemoryModelCache(), persistentCache: null });
  return {
    createExecutor: createProductionExecutor,
    decodeImage: (image, signal) =>
      decodeImage(image, { ...(signal === undefined ? {} : { signal }) }),
    fetchManifest: fetchManifest,
    modelManager,
    now: nowDefault,
    probeCapabilities: (signal) =>
      probeCapabilities(undefined, signal === undefined ? {} : { signal }),
    verifyModel: (data, variant) => verifyModelIntegrity(data, variant)
  };
}

async function fetchManifest(url: string, signal?: AbortSignal): Promise<ModelManifest> {
  throwIfAborted(signal);
  let response: Response;
  try {
    response = await fetch(url, signal === undefined ? {} : { signal });
  } catch (error) {
    if (signal?.aborted === true) throw abortError(signal);
    throw new DocLayoutError(
      "MODEL_DOWNLOAD_FAILED",
      `Unable to download model manifest from ${url}`,
      { stage: "manifest", url },
      { cause: error }
    );
  }
  if (!response.ok) {
    throw new DocLayoutError(
      "MODEL_DOWNLOAD_FAILED",
      `Model manifest request failed with ${response.status}`,
      {
        stage: "manifest",
        status: response.status,
        url
      }
    );
  }
  return parseModelManifest(await response.json());
}

async function createMainExecutor(
  options: CreateDetectorExecutorOptions
): Promise<InferenceExecutor> {
  const session = await createOrtSession({
    capabilities: options.capabilities,
    input: options.manifest.input,
    modelBytes: new Uint8Array(options.modelBytes),
    outputs: options.manifest.outputs,
    provider: options.provider,
    ...(options.wasm === undefined ? {} : { wasm: options.wasm })
  });
  return {
    dispose: () => session.dispose(),
    mode: "main",
    sessionCreateMs: session.sessionCreateMs,
    async detect(raster, detectOptions = {}) {
      options.onProgress?.({ phase: "preprocess", requestId: 0, status: "start" });
      const preprocessStartedAt = nowDefault();
      const input = preprocessRaster(raster, options.manifest.preprocessing, {
        ...(detectOptions.signal === undefined ? {} : { signal: detectOptions.signal })
      });
      const preprocessMs = elapsed(nowDefault, preprocessStartedAt);
      options.onProgress?.({ phase: "preprocess", requestId: 0, status: "complete" });
      options.onProgress?.({ phase: "inference", requestId: 0, status: "start" });
      const inference = await session.run(input.data, input.dims, {
        ...(detectOptions.signal === undefined ? {} : { signal: detectOptions.signal })
      });
      options.onProgress?.({ phase: "inference", requestId: 0, status: "complete" });
      options.onProgress?.({ phase: "postprocess", requestId: 0, status: "start" });
      const postprocessStartedAt = nowDefault();
      const detections = postprocessDetections(inference.outputs, {
        inputSize: options.manifest.preprocessing.size,
        labels: options.manifest.labels,
        targetSize: input.originalSize,
        ...(detectOptions.threshold === undefined ? {} : { threshold: detectOptions.threshold })
      });
      const postprocessMs = elapsed(nowDefault, postprocessStartedAt);
      options.onProgress?.({ phase: "postprocess", requestId: 0, status: "complete" });
      return {
        detections,
        timings: { inferenceMs: inference.inferenceMs, postprocessMs, preprocessMs }
      };
    }
  };
}

async function createProductionExecutor(
  options: CreateDetectorExecutorOptions
): Promise<InferenceExecutor> {
  return createWorkerBridge({
    fallback: () => createMainExecutor(options),
    init: {
      capabilities: options.capabilities,
      manifest: options.manifest,
      modelBytes: options.modelBytes,
      provider: options.provider,
      ...(options.wasm === undefined ? {} : { wasm: options.wasm })
    },
    ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress })
  });
}

export function createDocLayout(options: CreateDocLayoutOptions = {}): Promise<DocLayoutDetector> {
  return createDocLayoutWithDependencies(options, defaultDependencies(options.cache ?? true));
}

export function probeDocLayoutCapabilities(
  options: CapabilityProbeOptions = {}
): Promise<DocLayoutCapabilities> {
  return probeCapabilities(undefined, options);
}

export function clearModelCache(): Promise<void> {
  return new ModelManager().clearCache();
}

export function listModelCache(): Promise<readonly ModelCacheEntry[]> {
  return new ModelManager().listCache();
}
