import { DocLayoutError } from "../errors";
import { parseModelManifest } from "../model/manifest";
import { postprocessDetections } from "../postprocess";
import { preprocessRaster } from "../preprocess";
import { probeCapabilities } from "../runtime/capabilities";
import { createOrtSession, type OrtSession } from "../runtime/ort-session";
import type { ModelManifest } from "../types";
import type {
  SerializedWorkerError,
  WorkerMessageToMain,
  WorkerMessageToWorker,
  WorkerProgressPhase,
  WorkerProgressStatus
} from "./protocol";

const scope = globalThis as unknown as DedicatedWorkerGlobalScope;
const controllers = new Map<number, AbortController>();
let manifest: ModelManifest | undefined;
let session: OrtSession | undefined;

function post(message: WorkerMessageToMain): void {
  scope.postMessage(message);
}

function progress(
  requestId: number,
  phase: WorkerProgressPhase,
  status: WorkerProgressStatus
): void {
  post({ phase, requestId, status, type: "progress" });
}

function serializeError(error: unknown): SerializedWorkerError {
  if (error instanceof DocLayoutError) {
    return {
      code: error.code,
      details: error.details,
      message: error.message,
      name: error.name
    };
  }
  return {
    code: "INFERENCE_FAILED",
    details: {},
    message: error instanceof Error ? error.message : String(error),
    name: error instanceof Error ? error.name : "Error"
  };
}

async function initialize(message: Extract<WorkerMessageToWorker, { type: "init" }>): Promise<void> {
  manifest = parseModelManifest(message.payload.manifest);
  const capabilities = await probeCapabilities();
  if (message.payload.provider === "webgpu" && !capabilities.webgpu) {
    throw new DocLayoutError(
      "CAPABILITY_UNSUPPORTED",
      "WebGPU is unavailable inside the inference worker",
      { provider: "webgpu", workerProbe: capabilities.diagnostics }
    );
  }
  session = await createOrtSession({
    capabilities,
    input: manifest.input,
    modelBytes: new Uint8Array(message.payload.modelBytes),
    outputs: manifest.outputs,
    provider: message.payload.provider,
    ...(message.payload.wasm === undefined ? {} : { wasm: message.payload.wasm })
  });
  post({ requestId: message.requestId, sessionCreateMs: session.sessionCreateMs, type: "ready" });
}

async function detect(message: Extract<WorkerMessageToWorker, { type: "detect" }>): Promise<void> {
  if (manifest === undefined || session === undefined) {
    throw new DocLayoutError("INFERENCE_FAILED", "Inference worker is not initialized");
  }
  const controller = new AbortController();
  controllers.set(message.requestId, controller);
  try {
    progress(message.requestId, "preprocess", "start");
    const preprocessStartedAt = performance.now();
    const input = preprocessRaster(message.payload.raster, manifest.preprocessing, {
      signal: controller.signal
    });
    const preprocessMs = performance.now() - preprocessStartedAt;
    progress(message.requestId, "preprocess", "complete");

    progress(message.requestId, "inference", "start");
    const inference = await session.run(input.data, input.dims, { signal: controller.signal });
    progress(message.requestId, "inference", "complete");

    progress(message.requestId, "postprocess", "start");
    const postprocessStartedAt = performance.now();
    const detections = postprocessDetections(inference.outputs, {
      inputSize: manifest.preprocessing.size,
      labels: manifest.labels,
      targetSize: input.originalSize,
      ...(message.payload.threshold === undefined
        ? {}
        : { threshold: message.payload.threshold })
    });
    const postprocessMs = performance.now() - postprocessStartedAt;
    progress(message.requestId, "postprocess", "complete");
    post({
      payload: {
        detections,
        timings: { inferenceMs: inference.inferenceMs, postprocessMs, preprocessMs }
      },
      requestId: message.requestId,
      type: "result"
    });
  } finally {
    controllers.delete(message.requestId);
  }
}

scope.onmessage = (event: MessageEvent<WorkerMessageToWorker>) => {
  const message = event.data;
  if (message.type === "abort") {
    controllers.get(message.targetRequestId)?.abort(message.reason);
    return;
  }
  if (message.type === "dispose") {
    void session?.dispose().finally(() => {
      post({ requestId: message.requestId, type: "disposed" });
      scope.close();
    });
    return;
  }

  const operation = message.type === "init" ? initialize(message) : detect(message);
  void operation.catch((error: unknown) => {
    post({ error: serializeError(error), requestId: message.requestId, type: "error" });
  });
};
