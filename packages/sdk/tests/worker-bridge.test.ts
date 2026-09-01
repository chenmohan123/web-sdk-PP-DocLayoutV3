import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { parseModelManifest } from "../src/model/manifest";
import {
  createWorkerBridge,
  type InferenceExecutor,
  type WorkerBridge,
  type WorkerBridgeEnvironment,
  type WorkerLike
} from "../src/worker/worker-bridge";
import type {
  WorkerMessageToMain,
  WorkerMessageToWorker,
  WorkerProgress
} from "../src/worker/protocol";
import type { DocLayoutCapabilities, NormalizedRaster } from "../src/types";

const manifest = parseModelManifest(
  JSON.parse(
    readFileSync(
new URL("../../../models/pp-doclayoutv3/manifest.json", import.meta.url),
      "utf8"
    )
  )
);

class FakeWorker implements WorkerLike {
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessage: ((event: MessageEvent<WorkerMessageToMain>) => void) | null = null;
  readonly posts: Array<{
    readonly message: WorkerMessageToWorker;
    readonly transfer: readonly Transferable[];
  }> = [];
  readonly terminate = vi.fn();

  postMessage(message: WorkerMessageToWorker, transfer: readonly Transferable[] = []): void {
    this.posts.push({ message, transfer });
  }

  emit(message: WorkerMessageToMain): void {
    this.onmessage?.(new MessageEvent("message", { data: message }));
  }

  crash(message = "worker crashed"): void {
    this.onerror?.({ message } as ErrorEvent);
  }
}

function capabilities(overrides: Partial<DocLayoutCapabilities> = {}): DocLayoutCapabilities {
  return {
    crossOriginIsolated: true,
    diagnostics: [],
    wasm: true,
    wasmSimd: true,
    wasmThreads: true,
    webgpu: false,
    webgpuFp16: false,
    worker: true,
    ...overrides
  };
}

function raster(): NormalizedRaster {
  return { height: 1, rgba: new Uint8ClampedArray([1, 2, 3, 255]), width: 1 };
}

function fallbackExecutor(): InferenceExecutor {
  return {
    detect: vi.fn(() =>
      Promise.resolve({
        detections: [],
        timings: { inferenceMs: 3, postprocessMs: 1, preprocessMs: 2 }
      })
    ),
    dispose: vi.fn(() => Promise.resolve()),
    mode: "main",
    sessionCreateMs: 7
  };
}

function bridgeEnvironment(worker: FakeWorker): WorkerBridgeEnvironment {
  return {
    createWorker: vi.fn(() => worker),
    offscreenCanvas: true,
    worker: true
  };
}

function bridgePromise(
  worker: FakeWorker,
  options: { onProgress?: (progress: WorkerProgress) => void } = {}
): Promise<InferenceExecutor> {
  return createWorkerBridge({
    environment: bridgeEnvironment(worker),
    fallback: fallbackExecutor(),
    init: {
      capabilities: capabilities(),
      manifest,
      modelBytes: new Uint8Array([1, 2, 3]).buffer,
      provider: "wasm"
    },
    ...options
  });
}

async function readyBridge(worker: FakeWorker): Promise<WorkerBridge> {
  const pending = bridgePromise(worker);
  expect(worker.posts[0]?.message).toMatchObject({ requestId: 1, type: "init" });
  worker.emit({ requestId: 1, sessionCreateMs: 12, type: "ready" });
  const bridge = await pending;
  expect(bridge.mode).toBe("worker");
  return bridge as WorkerBridge;
}

describe("createWorkerBridge", () => {
  it("copies and transfers model and raster buffers with monotonic request IDs", async () => {
    const worker = new FakeWorker();
    const bridge = await readyBridge(worker);
    const init = worker.posts[0]!;

    expect(init.transfer).toHaveLength(1);
    expect(init.transfer[0]).toBe(
      (init.message as { payload: { modelBytes: ArrayBuffer } }).payload.modelBytes
    );
    expect(
      (init.message as { payload: { modelBytes: ArrayBuffer } }).payload.modelBytes.byteLength
    ).toBe(3);

    const classThresholds = { formula: 0.4, table: 0.55 };
    const pending = bridge.detect(raster(), { classThresholds, threshold: 0.5 });
    const request = worker.posts[1]!;
    expect(request.message).toMatchObject({
      payload: { classThresholds, threshold: 0.5 },
      requestId: 2,
      type: "detect"
    });
    expect(request.transfer).toHaveLength(1);
    worker.emit({
      payload: {
        detections: [],
        timings: { inferenceMs: 3, postprocessMs: 1, preprocessMs: 2 }
      },
      requestId: 2,
      type: "result"
    });

    await expect(pending).resolves.toMatchObject({ timings: { inferenceMs: 3 } });
    expect(raster().rgba.byteLength).toBe(4);
  });

  it("forwards progress for the matching request", async () => {
    const worker = new FakeWorker();
    const onProgress = vi.fn();
    const pendingBridge = bridgePromise(worker, { onProgress });
    worker.emit({ requestId: 1, sessionCreateMs: 12, type: "ready" });
    const bridge = await pendingBridge;
    const pending = bridge.detect(raster());

    worker.emit({ phase: "inference", requestId: 2, status: "start", type: "progress" });
    worker.emit({
      payload: {
        detections: [],
        timings: { inferenceMs: 1, postprocessMs: 1, preprocessMs: 1 }
      },
      requestId: 2,
      type: "result"
    });
    await pending;

    expect(onProgress).toHaveBeenCalledWith({
      phase: "inference",
      requestId: 2,
      status: "start"
    });
  });

  it("sends abort and rejects without waiting for a late result", async () => {
    const worker = new FakeWorker();
    const bridge = await readyBridge(worker);
    const controller = new AbortController();
    const pending = bridge.detect(raster(), { signal: controller.signal });

    controller.abort("cancelled");

    await expect(pending).rejects.toMatchObject({
      code: "ABORTED",
      details: { reason: "cancelled" }
    });
    expect(worker.posts[2]?.message).toMatchObject({
      requestId: 3,
      targetRequestId: 2,
      type: "abort"
    });
    worker.emit({
      payload: {
        detections: [],
        timings: { inferenceMs: 1, postprocessMs: 1, preprocessMs: 1 }
      },
      requestId: 2,
      type: "result"
    });
  });

  it("rejects pending inference when the worker crashes", async () => {
    const worker = new FakeWorker();
    const bridge = await readyBridge(worker);
    const pending = bridge.detect(raster());

    worker.crash("boom");

    await expect(pending).rejects.toMatchObject({
      code: "INFERENCE_FAILED",
      details: { stage: "worker" }
    });
  });

  it("terminates the worker when initialization fails", async () => {
    const worker = new FakeWorker();
    const pending = bridgePromise(worker);

    worker.emit({
      error: {
        code: "SESSION_CREATE_FAILED",
        details: { stage: "session-create" },
        message: "session rejected",
        name: "DocLayoutError"
      },
      requestId: 1,
      type: "error"
    });

    await expect(pending).rejects.toMatchObject({ code: "SESSION_CREATE_FAILED" });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("uses a lazy main-thread fallback when the worker lacks the selected capability", async () => {
    const worker = new FakeWorker();
    const fallback = fallbackExecutor();
    const createFallback = vi.fn(() => Promise.resolve(fallback));
    const pending = createWorkerBridge({
      environment: bridgeEnvironment(worker),
      fallback: createFallback,
      init: {
        capabilities: capabilities({ webgpu: true }),
        manifest,
        modelBytes: new ArrayBuffer(1),
        provider: "webgpu"
      }
    });

    worker.emit({
      error: {
        code: "CAPABILITY_UNSUPPORTED",
        details: { stage: "worker-init" },
        message: "worker has no WebGPU adapter",
        name: "DocLayoutError"
      },
      requestId: 1,
      type: "error"
    });

    await expect(pending).resolves.toBe(fallback);
    expect(createFallback).toHaveBeenCalledOnce();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("ignores late responses after idempotent disposal", async () => {
    const worker = new FakeWorker();
    const bridge = await readyBridge(worker);
    const pending = bridge.detect(raster());

    await bridge.dispose();
    await bridge.dispose();

    await expect(pending).rejects.toMatchObject({ code: "ABORTED" });
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(() =>
      worker.emit({
        payload: {
          detections: [],
          timings: { inferenceMs: 1, postprocessMs: 1, preprocessMs: 1 }
        },
        requestId: 2,
        type: "result"
      })
    ).not.toThrow();
  });

  it("uses the main-thread executor when Worker or OffscreenCanvas is unavailable", async () => {
    for (const environment of [
      { offscreenCanvas: true, worker: false },
      { offscreenCanvas: false, worker: true }
    ]) {
      const fallback = fallbackExecutor();
      const detect = vi.spyOn(fallback, "detect");
      const dispose = vi.spyOn(fallback, "dispose");
      const createWorker = vi.fn(() => new FakeWorker());
      const bridge = await createWorkerBridge({
        environment: { ...environment, createWorker },
        fallback,
        init: {
          capabilities: capabilities(),
          manifest,
          modelBytes: new ArrayBuffer(1),
          provider: "wasm"
        }
      });

      expect(bridge.mode).toBe("main");
      await bridge.detect(raster());
      expect(detect).toHaveBeenCalledOnce();
      expect(createWorker).not.toHaveBeenCalled();
      await bridge.dispose();
      expect(dispose).toHaveBeenCalledOnce();
    }
  });
});
