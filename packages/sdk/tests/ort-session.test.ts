import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { DocLayoutError } from "../src/errors";
import { parseModelManifest } from "../src/model/manifest";
import {
  createOrtSession,
  type OrtInferenceSessionLike,
  type OrtModuleLike,
  type OrtTensorLike
} from "../src/runtime/ort-session";
import type { DocLayoutCapabilities } from "../src/types";

const manifest = parseModelManifest(
  JSON.parse(
    readFileSync(
new URL("../../../models/pp-doclayoutv3/manifest.json", import.meta.url),
      "utf8"
    )
  )
);

class FakeTensor implements OrtTensorLike {
  readonly dispose = vi.fn();

  constructor(
    readonly data: Float32Array,
    readonly dims: readonly number[]
  ) {}
}

function capabilities(overrides: Partial<DocLayoutCapabilities> = {}): DocLayoutCapabilities {
  return {
    crossOriginIsolated: true,
    diagnostics: [],
    wasm: true,
    wasmSimd: true,
    wasmThreads: true,
    webgpu: true,
    webgpuFp16: true,
    worker: true,
    ...overrides
  };
}

function outputTensors(): Record<string, FakeTensor> {
  return Object.fromEntries(
    manifest.outputs.map((output, index) => [
      output.name,
      new FakeTensor(Float32Array.from([index + 1]), output.shape)
    ])
  );
}

function fakeOrt(
  options: {
    createError?: Error;
    outputs?: Record<string, FakeTensor>;
    runError?: Error;
  } = {}
): {
  readonly create: ReturnType<typeof vi.fn>;
  readonly ort: OrtModuleLike;
  readonly release: ReturnType<typeof vi.fn>;
  readonly run: ReturnType<typeof vi.fn>;
  readonly tensors: FakeTensor[];
} {
  const tensors: FakeTensor[] = [];
  const release = vi.fn(() => Promise.resolve());
  const run = vi.fn(() => {
    if (options.runError !== undefined) return Promise.reject(options.runError);
    return Promise.resolve(options.outputs ?? outputTensors());
  });
  const session: OrtInferenceSessionLike = { release, run };
  const create = vi.fn(() => {
    if (options.createError !== undefined) return Promise.reject(options.createError);
    return Promise.resolve(session);
  });
  const ort: OrtModuleLike = {
    env: { wasm: {} },
    InferenceSession: { create },
    Tensor: class extends FakeTensor {
      constructor(_type: "float32", data: Float32Array, dims: readonly number[]) {
        super(data, dims);
        tensors.push(this);
      }
    }
  };
  return { create, ort, release, run, tensors };
}

function nowSequence(...values: number[]): () => number {
  let index = 0;
  return () => values[index++] ?? values.at(-1) ?? 0;
}

describe("createOrtSession", () => {
  it("maps WebGPU options, measures creation and copies disposable outputs", async () => {
    const outputs = outputTensors();
    const fake = fakeOrt({ outputs });
    const runtime = await createOrtSession({
      capabilities: capabilities(),
      input: manifest.input,
      modelBytes: new Uint8Array([1, 2, 3]),
      now: nowSequence(10, 34, 40, 55),
      ort: fake.ort,
      outputs: manifest.outputs,
      provider: "webgpu",
      wasm: { paths: "https://cdn.example.test/ort/" }
    });

    expect(runtime.sessionCreateMs).toBe(24);
    expect(fake.create).toHaveBeenCalledOnce();
    expect(fake.create.mock.calls[0]?.[1]).toMatchObject({
      executionProviders: [{ name: "webgpu", preferredLayout: "NCHW" }]
    });
    expect(fake.ort.env.wasm.wasmPaths).toBe("https://cdn.example.test/ort/");

    const result = await runtime.run(new Float32Array(3 * 800 * 800), [1, 3, 800, 800]);

    expect(result.inferenceMs).toBe(15);
    expect(result.outputs.logits.data).toEqual(new Float32Array([1]));
    expect(result.outputs.predBoxes.data).toEqual(new Float32Array([2]));
    expect(fake.tensors[0]?.dispose).toHaveBeenCalledOnce();
    Object.values(outputs).forEach((tensor) => expect(tensor.dispose).toHaveBeenCalledOnce());
  });

  it("configures validated WASM SIMD, threads, and asset paths", async () => {
    const fake = fakeOrt();
    await createOrtSession({
      capabilities: capabilities(),
      hardwareConcurrency: 12,
      input: manifest.input,
      modelBytes: new Uint8Array([1]),
      ort: fake.ort,
      outputs: manifest.outputs,
      provider: "wasm",
      wasm: { paths: "https://cdn.example.test/ort/" }
    });

    expect(fake.ort.env.wasm).toMatchObject({
      numThreads: 4,
      simd: true,
      wasmPaths: "https://cdn.example.test/ort/"
    });
    expect(fake.create.mock.calls[0]?.[1]).toMatchObject({ executionProviders: ["wasm"] });
  });

  it("forces one WASM thread without validated thread support", async () => {
    const fake = fakeOrt();
    await createOrtSession({
      capabilities: capabilities({ wasmThreads: false }),
      hardwareConcurrency: 16,
      input: manifest.input,
      modelBytes: new Uint8Array([1]),
      ort: fake.ort,
      outputs: manifest.outputs,
      provider: "wasm",
      wasm: { numThreads: 8 }
    });

    expect(fake.ort.env.wasm.numThreads).toBe(1);
  });

  it("releases the input tensor after an execution failure and preserves the cause", async () => {
    const cause = new Error("GPU device was lost");
    const fake = fakeOrt({ runError: cause });
    const runtime = await createOrtSession({
      capabilities: capabilities(),
      input: manifest.input,
      modelBytes: new Uint8Array([1]),
      ort: fake.ort,
      outputs: manifest.outputs,
      provider: "webgpu"
    });

    let error: unknown;
    try {
      await runtime.run(new Float32Array(3), [1, 3, 1, 1]);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(DocLayoutError);
    expect(error).toMatchObject({ code: "INFERENCE_FAILED" });
    expect((error as Error).cause).toBe(cause);
    expect(fake.tensors[0]?.dispose).toHaveBeenCalledOnce();
  });

  it("maps memory exhaustion during creation and inference", async () => {
    const createFake = fakeOrt({ createError: new Error("WebAssembly.Memory(): out of memory") });
    await expect(
      createOrtSession({
        capabilities: capabilities(),
        input: manifest.input,
        modelBytes: new Uint8Array([1]),
        ort: createFake.ort,
        outputs: manifest.outputs,
        provider: "wasm"
      })
    ).rejects.toMatchObject({ code: "OUT_OF_MEMORY", details: { stage: "session-create" } });

    const runFake = fakeOrt({ runError: new Error("failed to allocate memory") });
    const runtime = await createOrtSession({
      capabilities: capabilities(),
      input: manifest.input,
      modelBytes: new Uint8Array([1]),
      ort: runFake.ort,
      outputs: manifest.outputs,
      provider: "wasm"
    });
    await expect(runtime.run(new Float32Array(3), [1, 3, 1, 1])).rejects.toMatchObject({
      code: "OUT_OF_MEMORY",
      details: { stage: "inference" }
    });
  });

  it("does not try another provider after explicit session creation fails", async () => {
    const fake = fakeOrt({ createError: new Error("adapter rejected") });

    await expect(
      createOrtSession({
        capabilities: capabilities(),
        input: manifest.input,
        modelBytes: new Uint8Array([1]),
        ort: fake.ort,
        outputs: manifest.outputs,
        provider: "webgpu"
      })
    ).rejects.toMatchObject({
      code: "SESSION_CREATE_FAILED",
      details: { causeMessage: "adapter rejected" }
    });
    expect(fake.create).toHaveBeenCalledOnce();
  });

  it("aborts before creating an input tensor", async () => {
    const fake = fakeOrt();
    const runtime = await createOrtSession({
      capabilities: capabilities(),
      input: manifest.input,
      modelBytes: new Uint8Array([1]),
      ort: fake.ort,
      outputs: manifest.outputs,
      provider: "wasm"
    });
    const controller = new AbortController();
    controller.abort("cancelled");

    await expect(
      runtime.run(new Float32Array(3), [1, 3, 1, 1], { signal: controller.signal })
    ).rejects.toMatchObject({ code: "ABORTED", details: { reason: "cancelled" } });
    expect(fake.tensors).toHaveLength(0);
  });

  it("releases the ORT session exactly once", async () => {
    const fake = fakeOrt();
    const runtime = await createOrtSession({
      capabilities: capabilities(),
      input: manifest.input,
      modelBytes: new Uint8Array([1]),
      ort: fake.ort,
      outputs: manifest.outputs,
      provider: "wasm"
    });

    await runtime.dispose();
    await runtime.dispose();

    expect(fake.release).toHaveBeenCalledOnce();
    await expect(runtime.run(new Float32Array(3), [1, 3, 1, 1])).rejects.toMatchObject({
      code: "INFERENCE_FAILED",
      details: { disposed: true }
    });
  });
});
