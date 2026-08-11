import { DocLayoutError } from "../errors";
import type { NormalizedRaster } from "../types";
import type {
  SerializedWorkerError,
  WorkerInferenceResult,
  WorkerInitPayload,
  WorkerMessageToMain,
  WorkerMessageToWorker,
  WorkerProgress
} from "./protocol";

export interface WorkerLike {
  onerror: ((event: ErrorEvent) => void) | null;
  onmessage: ((event: MessageEvent<WorkerMessageToMain>) => void) | null;
  postMessage(message: WorkerMessageToWorker, transfer?: readonly Transferable[]): void;
  terminate(): void;
}

export interface WorkerBridgeEnvironment {
  readonly createWorker?: () => WorkerLike;
  readonly offscreenCanvas: boolean;
  readonly worker: boolean;
}

export interface InferenceDetectOptions {
  readonly signal?: AbortSignal;
  readonly threshold?: number;
}

export interface InferenceExecutor {
  readonly mode: "main" | "worker";
  readonly sessionCreateMs: number;
  detect(raster: NormalizedRaster, options?: InferenceDetectOptions): Promise<WorkerInferenceResult>;
  dispose(): Promise<void>;
}

export interface WorkerBridge extends InferenceExecutor {
  readonly mode: "worker";
}

export interface CreateWorkerBridgeOptions {
  readonly environment?: WorkerBridgeEnvironment;
  readonly fallback: InferenceExecutor;
  readonly init: WorkerInitPayload;
  readonly onProgress?: (progress: WorkerProgress) => void;
}

interface PendingRequest<T> {
  readonly reject: (reason: unknown) => void;
  readonly resolve: (value: T) => void;
  readonly signal?: AbortSignal;
  readonly onAbort?: () => void;
}

function defaultEnvironment(): WorkerBridgeEnvironment {
  const workerSupported = typeof Worker === "function";
  return {
    ...(workerSupported
      ? {
          createWorker: () =>
            new Worker(new URL("./inference.worker.js", import.meta.url), {
              name: "pp-doclayoutv3-inference",
              type: "module"
            })
        }
      : {}),
    offscreenCanvas: typeof OffscreenCanvas === "function",
    worker: workerSupported
  };
}

function aborted(reason: unknown): DocLayoutError {
  return new DocLayoutError("ABORTED", "Worker inference was aborted", {
    reason: reason ?? "aborted"
  });
}

function deserializeError(error: SerializedWorkerError): DocLayoutError {
  const knownCodes = new Set([
    "CAPABILITY_UNSUPPORTED",
    "MANIFEST_INVALID",
    "MODEL_INCOMPATIBLE",
    "MODEL_DOWNLOAD_FAILED",
    "MODEL_INTEGRITY_FAILED",
    "IMAGE_INVALID",
    "SESSION_CREATE_FAILED",
    "INFERENCE_FAILED",
    "OUT_OF_MEMORY",
    "ABORTED"
  ]);
  return new DocLayoutError(
    knownCodes.has(error.code) ? (error.code as DocLayoutError["code"]) : "INFERENCE_FAILED",
    error.message,
    error.details
  );
}

class WorkerBridgeImplementation implements WorkerBridge {
  readonly mode = "worker";
  private disposed = false;
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingRequest<unknown>>();

  private constructor(
    private readonly workerInstance: WorkerLike,
    private readonly progressHandler: ((progress: WorkerProgress) => void) | undefined,
    readonly sessionCreateMs: number
  ) {
    workerInstance.onmessage = (event) => this.handleMessage(event.data);
    workerInstance.onerror = (event) => this.handleCrash(event);
  }

  static async create(
    worker: WorkerLike,
    init: WorkerInitPayload,
    onProgress: ((progress: WorkerProgress) => void) | undefined
  ): Promise<WorkerBridgeImplementation> {
    let nextRequestId = 1;
    const modelBytes = init.modelBytes.slice(0);
    const ready = new Promise<number>((resolve, reject) => {
      worker.onmessage = (event) => {
        const message = event.data;
        if (message.requestId !== 1) return;
        if (message.type === "ready") resolve(message.sessionCreateMs);
        if (message.type === "error") reject(deserializeError(message.error));
      };
      worker.onerror = (event) => {
        reject(
          new DocLayoutError("SESSION_CREATE_FAILED", "Inference worker failed to initialize", {
            message: event.message,
            stage: "worker-init"
          })
        );
      };
    });
    worker.postMessage(
      { payload: { ...init, modelBytes }, requestId: nextRequestId++, type: "init" },
      [modelBytes]
    );
    let sessionCreateMs: number;
    try {
      sessionCreateMs = await ready;
    } catch (error) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
      throw error;
    }
    const bridge = new WorkerBridgeImplementation(worker, onProgress, sessionCreateMs);
    bridge.nextRequestId = nextRequestId;
    return bridge;
  }

  detect(raster: NormalizedRaster, options: InferenceDetectOptions = {}): Promise<WorkerInferenceResult> {
    if (this.disposed) {
      return Promise.reject(
        new DocLayoutError("INFERENCE_FAILED", "Inference worker has been disposed", {
          disposed: true
        })
      );
    }
    if (options.signal?.aborted === true) return Promise.reject(aborted(options.signal.reason));

    const requestId = this.nextRequestId++;
    const rgba = new Uint8ClampedArray(raster.rgba);
    const payload = {
      raster: { height: raster.height, rgba, width: raster.width },
      ...(options.threshold === undefined ? {} : { threshold: options.threshold })
    };
    return new Promise<WorkerInferenceResult>((resolve, reject) => {
      const onAbort =
        options.signal === undefined
          ? undefined
          : (): void => {
              this.finishPending(requestId, "reject", aborted(options.signal!.reason));
              const abortRequestId = this.nextRequestId++;
              this.workerInstance.postMessage({
                reason: options.signal!.reason,
                requestId: abortRequestId,
                targetRequestId: requestId,
                type: "abort"
              });
            };
      this.pending.set(requestId, {
        ...(onAbort === undefined ? {} : { onAbort }),
        reject,
        resolve: (value) => resolve(value as WorkerInferenceResult),
        ...(options.signal === undefined ? {} : { signal: options.signal })
      });
      options.signal?.addEventListener("abort", onAbort!, { once: true });
      this.workerInstance.postMessage({ payload, requestId, type: "detect" }, [
        rgba.buffer
      ]);
    });
  }

  dispose(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.disposed = true;
    for (const requestId of [...this.pending.keys()]) {
      this.finishPending(requestId, "reject", aborted("disposed"));
    }
    this.workerInstance.onmessage = null;
    this.workerInstance.onerror = null;
    this.workerInstance.terminate();
    return Promise.resolve();
  }

  private finishPending(
    requestId: number,
    action: "resolve" | "reject",
    value: unknown
  ): void {
    const pending = this.pending.get(requestId);
    if (pending === undefined) return;
    this.pending.delete(requestId);
    if (pending.onAbort !== undefined) {
      pending.signal?.removeEventListener("abort", pending.onAbort);
    }
    if (action === "resolve") pending.resolve(value);
    else pending.reject(value);
  }

  private handleMessage(message: WorkerMessageToMain): void {
    if (this.disposed) return;
    if (message.type === "progress") {
      this.progressHandler?.({
        phase: message.phase,
        requestId: message.requestId,
        status: message.status
      });
      return;
    }
    if (message.type === "result") {
      this.finishPending(message.requestId, "resolve", message.payload);
      return;
    }
    if (message.type === "error") {
      this.finishPending(message.requestId, "reject", deserializeError(message.error));
    }
  }

  private handleCrash(event: ErrorEvent): void {
    if (this.disposed) return;
    this.disposed = true;
    const error = new DocLayoutError("INFERENCE_FAILED", "Inference worker crashed", {
      message: event.message,
      stage: "worker"
    });
    for (const requestId of [...this.pending.keys()]) {
      this.finishPending(requestId, "reject", error);
    }
    this.workerInstance.terminate();
  }
}

export async function createWorkerBridge(
  options: CreateWorkerBridgeOptions
): Promise<InferenceExecutor> {
  const environment = options.environment ?? defaultEnvironment();
  if (
    !environment.worker ||
    !environment.offscreenCanvas ||
    environment.createWorker === undefined
  ) {
    return options.fallback;
  }
  return WorkerBridgeImplementation.create(
    environment.createWorker(),
    options.init,
    options.onProgress
  );
}
