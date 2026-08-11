import type { LayoutDetection } from "../postprocess";
import type {
  DocLayoutCapabilities,
  ModelBackend,
  ModelManifest,
  NormalizedRaster
} from "../types";
import type { OrtWasmOptions } from "../runtime/ort-session";

export type WorkerProgressPhase = "preprocess" | "inference" | "postprocess";
export type WorkerProgressStatus = "start" | "complete";

export interface WorkerProgress {
  readonly phase: WorkerProgressPhase;
  readonly requestId: number;
  readonly status: WorkerProgressStatus;
}

export interface WorkerInferenceTimings {
  readonly inferenceMs: number;
  readonly postprocessMs: number;
  readonly preprocessMs: number;
}

export interface WorkerInferenceResult {
  readonly detections: readonly LayoutDetection[];
  readonly timings: WorkerInferenceTimings;
}

export interface WorkerInitPayload {
  readonly capabilities: DocLayoutCapabilities;
  readonly manifest: ModelManifest;
  readonly modelBytes: ArrayBuffer;
  readonly provider: ModelBackend;
  readonly wasm?: OrtWasmOptions;
}

export interface WorkerDetectPayload {
  readonly raster: NormalizedRaster;
  readonly threshold?: number;
}

export type WorkerMessageToWorker =
  | { readonly payload: WorkerInitPayload; readonly requestId: number; readonly type: "init" }
  | { readonly payload: WorkerDetectPayload; readonly requestId: number; readonly type: "detect" }
  | {
      readonly reason?: unknown;
      readonly requestId: number;
      readonly targetRequestId: number;
      readonly type: "abort";
    }
  | { readonly requestId: number; readonly type: "dispose" };

export interface SerializedWorkerError {
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;
  readonly message: string;
  readonly name: string;
}

export type WorkerMessageToMain =
  | { readonly requestId: number; readonly sessionCreateMs: number; readonly type: "ready" }
  | { readonly payload: WorkerInferenceResult; readonly requestId: number; readonly type: "result" }
  | ({ readonly type: "progress" } & WorkerProgress)
  | { readonly error: SerializedWorkerError; readonly requestId: number; readonly type: "error" }
  | { readonly requestId: number; readonly type: "disposed" };
