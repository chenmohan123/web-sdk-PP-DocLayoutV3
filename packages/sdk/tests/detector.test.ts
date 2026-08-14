import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import type { ModelCacheEntry } from "../src/cache/model-cache";
import {
  DEFAULT_ORT_WASM_BASE_URL,
  DEFAULT_MANIFEST_URL,
  createDocLayoutWithDependencies,
  type DetectorDependencies,
  type DocLayoutProgressEvent
} from "../src/detector";
import { DocLayoutError } from "../src/errors";
import { parseModelManifest } from "../src/model/manifest";
import type { LoadedModel, ModelLoadOptions } from "../src/model/model-manager";
import type { DocLayoutCapabilities, ModelManifest, ModelVariant } from "../src/types";
import type { InferenceExecutor } from "../src/worker/worker-bridge";

const manifest = parseModelManifest(
  JSON.parse(
    readFileSync(
      new URL("../../../models/pp-doclayoutv3/1.0.0/manifest.json", import.meta.url),
      "utf8"
    )
  )
);

function capabilities(overrides: Partial<DocLayoutCapabilities> = {}): DocLayoutCapabilities {
  return {
    crossOriginIsolated: true,
    diagnostics: [],
    wasm: true,
    wasmSimd: true,
    wasmThreads: true,
    webgpu: false,
    webgpuFp16: false,
    worker: false,
    ...overrides
  };
}

function executor(
  detect: InferenceExecutor["detect"] = vi.fn(() =>
    Promise.resolve({
      detections: [],
      timings: { inferenceMs: 3, postprocessMs: 2, preprocessMs: 1 }
    })
  )
): InferenceExecutor {
  return {
    detect,
    dispose: vi.fn(() => Promise.resolve()),
    mode: "main",
    sessionCreateMs: 4
  };
}

function dependencies(overrides: Partial<DetectorDependencies> = {}): DetectorDependencies {
  const modelManager = {
    clearCache: vi.fn(() => Promise.resolve()),
    listCache: vi.fn(() => Promise.resolve([] as readonly ModelCacheEntry[])),
    load: vi.fn(
      (
        _manifest: ModelManifest,
        variant: ModelVariant,
        options: ModelLoadOptions = {}
      ): Promise<LoadedModel> => {
        options.onProgress?.({ loadedBytes: variant.bytes, totalBytes: variant.bytes });
        return Promise.resolve({
          data: new ArrayBuffer(variant.bytes),
          downloadedBytes: variant.bytes,
          source: "network",
          modelDownloadMs: 2,
          modelCacheMs: 0,
          integrityMs: 1,
          modelSource: "network"
        });
      }
    )
  };
  let time = 0;
  return {
    createExecutor: vi.fn(() => Promise.resolve(executor())),
    decodeImage: vi.fn(() =>
      Promise.resolve({
        height: 2,
        rgba: new Uint8ClampedArray(4 * 3 * 2),
        width: 3
      })
    ),
    fetchManifest: vi.fn(() => Promise.resolve(manifest)),
    modelManager,
    now: () => ++time,
    probeCapabilities: vi.fn(() => Promise.resolve(capabilities())),
    verifyModel: vi.fn(() => Promise.resolve()),
    ...overrides
  };
}

describe("createDocLayout", () => {
  it("uses the pinned default manifest with zero configuration", async () => {
    const deps = dependencies();

    expect(DEFAULT_MANIFEST_URL).toBe(
      "https://chenmohan123.github.io/web-sdk-PP-DocLayoutV3/models/v1.0.0/manifest.json"
    );

    const detector = await createDocLayoutWithDependencies({}, deps);

    expect(deps.fetchManifest).toHaveBeenCalledWith(DEFAULT_MANIFEST_URL, undefined);
    expect(detector.model.id).toBe("pp-doclayoutv3");
    expect(detector.runtime).toMatchObject({ backend: "wasm", precision: "fp32" });
    expect(vi.mocked(deps.createExecutor).mock.calls[0]?.[0].wasm).toEqual({
      paths: DEFAULT_ORT_WASM_BASE_URL
    });
  });

  it("allows the pinned ORT WASM asset base URL to be overridden", async () => {
    const deps = dependencies();

    await createDocLayoutWithDependencies(
      { ort: { wasm: { numThreads: 1, paths: "https://assets.example.test/ort/" } } },
      deps
    );

    expect(vi.mocked(deps.createExecutor).mock.calls[0]?.[0].wasm).toEqual({
      numThreads: 1,
      paths: "https://assets.example.test/ort/"
    });
  });

  it("loads a custom manifest URL", async () => {
    const deps = dependencies();
    const url = "https://models.example.test/custom-manifest.json";

    await createDocLayoutWithDependencies({ model: url }, deps);

    expect(deps.fetchManifest).toHaveBeenCalledWith(url, undefined);
  });

  it("uses inline manifest data without downloading the model", async () => {
    const deps = dependencies();
    const load = vi.spyOn(deps.modelManager, "load");
    const data = new Uint8Array([1, 2, 3]).buffer;

    const detector = await createDocLayoutWithDependencies({ model: { data, manifest } }, deps);

    expect(load).not.toHaveBeenCalled();
    expect(deps.verifyModel).toHaveBeenCalledWith(data, manifest.variants[1]);
    expect(deps.createExecutor).toHaveBeenCalledWith(expect.objectContaining({ modelBytes: data }));
    expect(detector.loadTimings).toMatchObject({
      integrityMs: 1,
      modelCacheMs: 0,
      modelDownloadMs: 0,
      modelSource: "custom"
    });
  });

  it("falls back automatically and records the failed candidate cause", async () => {
    const createExecutor = vi
      .fn()
      .mockRejectedValueOnce(
        new DocLayoutError("SESSION_CREATE_FAILED", "FP16 session failed", {
          stage: "session-create"
        })
      )
      .mockResolvedValueOnce(executor());
    const deps = dependencies({
      createExecutor,
      probeCapabilities: vi.fn(() =>
        Promise.resolve(capabilities({ webgpu: true, webgpuFp16: true }))
      )
    });

    const detector = await createDocLayoutWithDependencies({}, deps);
    const result = await detector.detect({
      height: 2,
      rgba: new Uint8ClampedArray(24),
      width: 3
    });

    expect(createExecutor).toHaveBeenCalledTimes(2);
    expect(result.runtime).toMatchObject({ backend: "wasm", precision: "fp32" });
    expect(result.runtime.fallbacks).toHaveLength(1);
    expect(result.runtime.fallbacks[0]).toMatchObject({
      code: "SESSION_CREATE_FAILED",
      precision: "fp16",
      provider: "webgpu",
      variantId: "fp16"
    });
    expect(detector.loadTimings).toMatchObject({
      integrityMs: 2,
      modelDownloadMs: 4,
      modelSource: "network"
    });
  });

  it("does not fall back from an explicit selection unless enabled", async () => {
    const createExecutor = vi.fn(() =>
      Promise.reject(new DocLayoutError("SESSION_CREATE_FAILED", "adapter rejected"))
    );
    const deps = dependencies({
      createExecutor,
      probeCapabilities: vi.fn(() =>
        Promise.resolve(capabilities({ webgpu: true, webgpuFp16: true }))
      )
    });

    await expect(
      createDocLayoutWithDependencies({ backend: "webgpu", precision: "fp16" }, deps)
    ).rejects.toMatchObject({ code: "SESSION_CREATE_FAILED" });
    expect(createExecutor).toHaveBeenCalledOnce();
  });

  it("reports load progress in phase order", async () => {
    const progress: DocLayoutProgressEvent[] = [];

    await createDocLayoutWithDependencies(
      { onProgress: (event) => progress.push(event) },
      dependencies()
    );

    expect(progress.map(({ phase, status }) => `${phase}:${status}`)).toEqual([
      "capabilities:start",
      "capabilities:complete",
      "manifest:start",
      "manifest:complete",
      "model:start",
      "model:progress",
      "model:complete",
      "session:start",
      "session:complete",
      "ready:complete"
    ]);
  });

  it("returns complete timing, runtime, model, and image information", async () => {
    const detector = await createDocLayoutWithDependencies({}, dependencies());

    const result = await detector.detect({
      height: 2,
      rgba: new Uint8ClampedArray(24),
      width: 3
    });

    expect(result.timings).toEqual({
      decodeMs: 1,
      inferenceMs: 3,
      postprocessMs: 2,
      preprocessMs: 1,
      totalMs: 3
    });
    expect(detector.loadTimings).toEqual({
      capabilitiesMs: 1,
      manifestMs: 1,
      modelMs: 1,
      modelDownloadMs: 2,
      modelCacheMs: 0,
      integrityMs: 1,
      modelSource: "network",
      sessionMs: 1,
      totalMs: 9
    });
    expect(result.image).toEqual({
      input: { height: 800, width: 800 },
      original: { height: 2, width: 3 }
    });
    expect(result.model).toMatchObject({
      bytes: manifest.variants[1]!.bytes,
      parameterCount: 33175165,
      sha256: manifest.variants[1]!.sha256
    });
  });

  it("serializes concurrent detections", async () => {
    let releaseFirst: (() => void) | undefined;
    const detect = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseFirst = () =>
              resolve({
                detections: [],
                timings: { inferenceMs: 1, postprocessMs: 1, preprocessMs: 1 }
              });
          })
      )
      .mockResolvedValue({
        detections: [],
        timings: { inferenceMs: 1, postprocessMs: 1, preprocessMs: 1 }
      });
    const deps = dependencies({
      createExecutor: vi.fn(() => Promise.resolve(executor(detect)))
    });
    const detector = await createDocLayoutWithDependencies({}, deps);
    const image = { height: 1, rgba: new Uint8ClampedArray(4), width: 1 };

    const first = detector.detect(image);
    const second = detector.detect(image);
    await Promise.resolve();
    await Promise.resolve();

    expect(detect).toHaveBeenCalledOnce();
    releaseFirst?.();
    await first;
    await second;
    expect(detect).toHaveBeenCalledTimes(2);
  });

  it("propagates abort and exposes cache methods", async () => {
    const deps = dependencies();
    const clearCache = vi.spyOn(deps.modelManager, "clearCache");
    const listCache = vi.spyOn(deps.modelManager, "listCache");
    const detector = await createDocLayoutWithDependencies({}, deps);
    const controller = new AbortController();
    controller.abort("cancelled");

    await expect(
      detector.detect(
        { height: 1, rgba: new Uint8ClampedArray(4), width: 1 },
        { signal: controller.signal }
      )
    ).rejects.toMatchObject({ code: "ABORTED", details: { reason: "cancelled" } });
    await detector.clearModelCache();
    await detector.listModelCache();
    expect(clearCache).toHaveBeenCalledOnce();
    expect(listCache).toHaveBeenCalledOnce();
  });

  it("rejects detection after idempotent disposal", async () => {
    const runtime = executor();
    const dispose = vi.spyOn(runtime, "dispose");
    const detector = await createDocLayoutWithDependencies(
      {},
      dependencies({ createExecutor: vi.fn(() => Promise.resolve(runtime)) })
    );
    await detector.dispose();
    await detector.dispose();

    await expect(
      detector.detect({ height: 1, rgba: new Uint8ClampedArray(4), width: 1 })
    ).rejects.toMatchObject({ code: "INFERENCE_FAILED", details: { disposed: true } });
    expect(dispose).toHaveBeenCalledOnce();
  });
});
