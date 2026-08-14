import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { probeCapabilities } from "../src/runtime/capabilities";
import { selectExecutionPlan } from "../src/runtime/select-plan";
import { parseModelManifest } from "../src/model/manifest";
import { DocLayoutError } from "../src/errors";
import type { DocLayoutCapabilities, ModelVariant } from "../src/types";

const manifest = parseModelManifest(
  JSON.parse(
    readFileSync(
      new URL("../../../models/pp-doclayoutv3/1.0.0/manifest.json", import.meta.url),
      "utf8"
    )
  )
);

const int8Variant: ModelVariant = {
  ...manifest.variants.find((variant) => variant.id === "fp32")!,
  backendCompatibility: ["wasm"],
  filename: "model-int8.onnx",
  id: "int8",
  precision: "int8",
  sha256: "a".repeat(64),
  url: "https://example.com/model-int8.onnx"
};

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

describe("selectExecutionPlan", () => {
  it("uses the exact automatic candidate order", () => {
    const plan = selectExecutionPlan({}, capabilities(), [...manifest.variants, int8Variant]);

    expect(plan.candidates.map(({ provider, precision }) => [provider, precision])).toEqual([
      ["webgpu", "fp16"],
      ["webgpu", "fp32"],
      ["wasm", "int8"],
      ["wasm", "fp32"]
    ]);
    expect(plan.selected).toMatchObject({
      precision: "fp16",
      provider: "webgpu",
      variantId: "fp16"
    });
    expect(plan.candidates[0]).toMatchObject({ status: "selected" });
    expect(plan.candidates.every((candidate) => candidate.reason.length > 0)).toBe(true);
  });

  it("skips WebGPU FP16 when shader-f16 is missing", () => {
    const plan = selectExecutionPlan({}, capabilities({ webgpuFp16: false }), manifest.variants);

    expect(plan.selected).toMatchObject({ provider: "webgpu", precision: "fp32" });
    expect(plan.candidates[0]).toMatchObject({ status: "skipped" });
    expect(plan.candidates[0]!.reason).toMatch(/shader-f16/);
  });

  it("skips an absent INT8 variant and falls back to WASM FP32", () => {
    const plan = selectExecutionPlan(
      {},
      capabilities({ webgpu: false, webgpuFp16: false }),
      manifest.variants
    );

    expect(plan.selected).toMatchObject({ provider: "wasm", precision: "fp32" });
    expect(plan.candidates[2]).toMatchObject({ status: "skipped", variantId: null });
    expect(plan.candidates[2]!.reason).toMatch(/variant/i);
  });

  it("does not fall back from explicit WebGPU mode", () => {
    let error: unknown;
    try {
      selectExecutionPlan(
        { backend: "webgpu", allowFallback: false },
        capabilities({ webgpu: false, webgpuFp16: false }),
        [...manifest.variants, int8Variant]
      );
    } catch (caught) {
      error = caught;
    }

    if (!(error instanceof DocLayoutError)) {
      throw error;
    }
    expect(error.code).toBe("CAPABILITY_UNSUPPORTED");
    expect(error.details).toMatchObject({ backend: "webgpu", allowFallback: false });
  });

  it("falls back from an explicit precision only when allowed", () => {
    const plan = selectExecutionPlan(
      { precision: "fp16", allowFallback: true },
      capabilities({ webgpuFp16: false }),
      manifest.variants
    );

    expect(plan.selected).toMatchObject({ provider: "webgpu", precision: "fp32" });
    expect(plan.selected.reason).toMatch(/fallback/i);
  });

  it("rejects FP16 when CPU/WASM is explicitly selected", () => {
    let caught: unknown;
    try {
      selectExecutionPlan(
        { backend: "wasm", precision: "fp16", allowFallback: true },
        capabilities(),
        manifest.variants
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(DocLayoutError);
    expect(caught).toMatchObject({
      code: "CAPABILITY_UNSUPPORTED",
      details: { allowFallback: true, backend: "wasm", precision: "fp16" }
    });
  });

  it("allows a validated custom FP16 variant on CPU/WASM", () => {
    const wasmFp16: ModelVariant = {
      ...manifest.variants.find((variant) => variant.id === "fp16")!,
      backendCompatibility: ["wasm"],
      id: "wasm-fp16"
    };

    const plan = selectExecutionPlan(
      { backend: "wasm", precision: "fp16", allowFallback: true },
      capabilities(),
      [...manifest.variants, wasmFp16]
    );

    expect(plan.selected).toMatchObject({
      precision: "fp16",
      provider: "wasm",
      variantId: "wasm-fp16"
    });
  });

  it("selects WASM INT8 before WASM FP32 when WebGPU is unavailable", () => {
    const plan = selectExecutionPlan({}, capabilities({ webgpu: false, webgpuFp16: false }), [
      ...manifest.variants,
      int8Variant
    ]);

    expect(plan.selected).toMatchObject({
      provider: "wasm",
      precision: "int8",
      variantId: "int8"
    });
  });
});

describe("probeCapabilities", () => {
  it("reports WebGPU, FP16, WASM, isolation, threads and worker support", async () => {
    const result = await probeCapabilities({
      crossOriginIsolated: true,
      requestAdapter: () => Promise.resolve({ features: new Set(["shader-f16"]) }),
      sharedArrayBuffer: true,
      validateWasm: () => true,
      worker: true
    });

    expect(result).toMatchObject({
      crossOriginIsolated: true,
      wasm: true,
      wasmSimd: true,
      wasmThreads: true,
      webgpu: true,
      webgpuFp16: true,
      worker: true
    });
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("aborts while waiting for a WebGPU adapter", async () => {
    const controller = new AbortController();
    const pending = probeCapabilities(
      {
        crossOriginIsolated: false,
        requestAdapter: () => new Promise(() => undefined),
        sharedArrayBuffer: false,
        validateWasm: () => false,
        worker: false
      },
      { signal: controller.signal }
    );

    controller.abort("cancelled");

    await expect(pending).rejects.toMatchObject({
      code: "ABORTED",
      details: { reason: "cancelled" }
    });
  });
});
