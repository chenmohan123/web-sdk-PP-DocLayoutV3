import { DocLayoutError } from "../errors";
import type { PPDocLayoutRawOutputs, PostprocessTensor } from "../postprocess";
import type { DocLayoutCapabilities, ModelBackend, TensorSpec } from "../types";

export interface OrtTensorLike {
  readonly data: unknown;
  readonly dims: readonly number[];
  dispose(): void;
}

export interface OrtInferenceSessionLike {
  release(): Promise<void>;
  run(
    feeds: Readonly<Record<string, OrtTensorLike>>,
    options?: { terminate?: boolean }
  ): Promise<Readonly<Record<string, OrtTensorLike | undefined>>>;
}

export interface OrtModuleLike {
  readonly env: {
    readonly wasm: {
      numThreads?: number;
      simd?: boolean | "fixed" | "relaxed";
      wasmPaths?: string | Readonly<Record<string, string | URL>>;
    };
  };
  readonly InferenceSession: {
    create(
      model: Uint8Array,
      options: Readonly<Record<string, unknown>>
    ): Promise<OrtInferenceSessionLike>;
  };
  readonly Tensor: new (
    type: "float32",
    data: Float32Array,
    dims: readonly number[]
  ) => OrtTensorLike;
}

export interface OrtWasmOptions {
  readonly numThreads?: number;
  readonly paths?: string | Readonly<Record<string, string | URL>>;
}

export interface CreateOrtSessionOptions {
  readonly capabilities: DocLayoutCapabilities;
  readonly hardwareConcurrency?: number;
  readonly input: TensorSpec;
  readonly modelBytes: Uint8Array;
  readonly now?: () => number;
  readonly ort?: OrtModuleLike;
  readonly outputs: readonly TensorSpec[];
  readonly provider: ModelBackend;
  readonly wasm?: OrtWasmOptions;
}

export interface OrtRunOptions {
  readonly signal?: AbortSignal;
}

export interface OrtRunResult {
  readonly inferenceMs: number;
  readonly outputs: PPDocLayoutRawOutputs;
}

export interface OrtSession {
  readonly provider: ModelBackend;
  readonly sessionCreateMs: number;
  dispose(): Promise<void>;
  run(data: Float32Array, dims: readonly number[], options?: OrtRunOptions): Promise<OrtRunResult>;
}

const OUTPUT_ROLES = ["logits", "predBoxes", "orderLogits", "outMasks"] as const;
const MAX_WASM_THREADS = 4;

function nowDefault(): number {
  return typeof performance === "object" ? performance.now() : Date.now();
}

async function defaultOrt(provider: ModelBackend): Promise<OrtModuleLike> {
  return (provider === "webgpu"
    ? await import("onnxruntime-web/webgpu")
    : await import("onnxruntime-web")) as unknown as OrtModuleLike;
}

function abortError(signal: AbortSignal): DocLayoutError {
  return new DocLayoutError("ABORTED", "ONNX inference was aborted", {
    reason: signal.reason ?? "aborted"
  });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw abortError(signal);
}

function isOutOfMemory(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /out of memory|failed to allocate|memory allocation|array buffer allocation failed|\boom\b/i.test(
    message
  );
}

function mapRuntimeError(
  error: unknown,
  stage: "session-create" | "inference",
  provider: ModelBackend
): DocLayoutError {
  if (error instanceof DocLayoutError) return error;
  const code = isOutOfMemory(error)
    ? "OUT_OF_MEMORY"
    : stage === "session-create"
      ? "SESSION_CREATE_FAILED"
      : "INFERENCE_FAILED";
  const causeMessage = error instanceof Error ? error.message : String(error);
  return new DocLayoutError(
    code,
    `ONNX ${stage} failed for ${provider}`,
    { causeMessage, provider, stage },
    { cause: error }
  );
}

function sessionOptions(provider: ModelBackend): Readonly<Record<string, unknown>> {
  return {
    executionProviders:
      provider === "webgpu" ? [{ name: "webgpu", preferredLayout: "NCHW" }] : ["wasm"],
    executionMode: "sequential",
    graphOptimizationLevel: "all"
  };
}

function configureWasm(ort: OrtModuleLike, options: CreateOrtSessionOptions): void {
  if (options.wasm?.paths !== undefined) ort.env.wasm.wasmPaths = options.wasm.paths;
  if (options.provider !== "wasm") return;
  const hardwareConcurrency = Math.max(
    1,
    Math.floor(options.hardwareConcurrency ?? globalThis.navigator?.hardwareConcurrency ?? 1)
  );
  ort.env.wasm.numThreads = options.capabilities.wasmThreads
    ? Math.min(
        MAX_WASM_THREADS,
        options.wasm?.numThreads ?? Math.max(1, Math.ceil(hardwareConcurrency / 2))
      )
    : 1;
  ort.env.wasm.simd = options.capabilities.wasmSimd;
}

function copyTensor(name: string, tensor: OrtTensorLike | undefined): PostprocessTensor {
  if (tensor === undefined || !(tensor.data instanceof Float32Array)) {
    throw new DocLayoutError("INFERENCE_FAILED", `ONNX output ${name} is missing or not float32`, {
      name
    });
  }
  return { data: new Float32Array(tensor.data), dims: [...tensor.dims] };
}

function copyOutputs(
  raw: Readonly<Record<string, OrtTensorLike | undefined>>,
  specs: readonly TensorSpec[]
): PPDocLayoutRawOutputs {
  if (specs.length !== OUTPUT_ROLES.length) {
    throw new DocLayoutError("INFERENCE_FAILED", "PP-DocLayoutV3 requires exactly four outputs", {
      outputs: specs.length
    });
  }
  return Object.fromEntries(
    OUTPUT_ROLES.map((role, index) => {
      const name = specs[index]!.name;
      return [role, copyTensor(name, raw[name])];
    })
  ) as unknown as PPDocLayoutRawOutputs;
}

function disposeOutputs(outputs: Readonly<Record<string, OrtTensorLike | undefined>>): void {
  const disposed = new Set<OrtTensorLike>();
  for (const output of Object.values(outputs)) {
    if (output !== undefined && !disposed.has(output)) {
      disposed.add(output);
      output.dispose();
    }
  }
}

export async function createOrtSession(options: CreateOrtSessionOptions): Promise<OrtSession> {
  const ort = options.ort ?? (await defaultOrt(options.provider));
  const now = options.now ?? nowDefault;
  configureWasm(ort, options);

  const startedAt = now();
  let session: OrtInferenceSessionLike;
  try {
    session = await ort.InferenceSession.create(
      options.modelBytes,
      sessionOptions(options.provider)
    );
  } catch (error) {
    throw mapRuntimeError(error, "session-create", options.provider);
  }
  const sessionCreateMs = Math.max(0, now() - startedAt);
  let disposed = false;
  let releasePromise: Promise<void> | undefined;

  return {
    provider: options.provider,
    sessionCreateMs,
    dispose() {
      if (releasePromise !== undefined) return releasePromise;
      disposed = true;
      releasePromise = session.release();
      return releasePromise;
    },
    async run(data, dims, runOptions = {}) {
      if (disposed) {
        throw new DocLayoutError("INFERENCE_FAILED", "ONNX session has been disposed", {
          disposed: true
        });
      }
      throwIfAborted(runOptions.signal);
      const input = new ort.Tensor("float32", data, dims);
      const ortRunOptions: { terminate?: boolean } = {};
      const onAbort = (): void => {
        ortRunOptions.terminate = true;
      };
      runOptions.signal?.addEventListener("abort", onAbort, { once: true });
      const inferenceStartedAt = now();
      let rawOutputs: Readonly<Record<string, OrtTensorLike | undefined>> | undefined;
      try {
        rawOutputs = await session.run({ [options.input.name]: input }, ortRunOptions);
        throwIfAborted(runOptions.signal);
        return {
          inferenceMs: Math.max(0, now() - inferenceStartedAt),
          outputs: copyOutputs(rawOutputs, options.outputs)
        };
      } catch (error) {
        if (runOptions.signal?.aborted === true) throw abortError(runOptions.signal);
        throw mapRuntimeError(error, "inference", options.provider);
      } finally {
        runOptions.signal?.removeEventListener("abort", onAbort);
        input.dispose();
        if (rawOutputs !== undefined) disposeOutputs(rawOutputs);
      }
    }
  };
}
