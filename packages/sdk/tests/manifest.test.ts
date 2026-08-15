import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { DocLayoutError } from "../src/errors";
import { CURRENT_SDK_VERSION, parseModelManifest } from "../src/model/manifest";

const defaultManifest = JSON.parse(
  readFileSync(
    new URL("../../../models/pp-doclayoutv3/1.0.1/manifest.json", import.meta.url),
    "utf8"
  )
) as unknown;

function copyManifest(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(defaultManifest)) as Record<string, unknown>;
}

function captureManifestError(input: unknown): DocLayoutError {
  try {
    parseModelManifest(input);
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(DocLayoutError);
    if (error instanceof DocLayoutError) {
      return error;
    }
  }
  throw new Error("Expected parseModelManifest to throw a DocLayoutError");
}

function expectManifestError(input: unknown, message: RegExp): void {
  const error = captureManifestError(input);
  expect(error.code).toBe("MANIFEST_INVALID");
  expect(error.message).toMatch(message);
}

describe("parseModelManifest", () => {
  it("reports the published SDK version", () => {
    expect(CURRENT_SDK_VERSION).toBe("1.0.5");
  });

  it("parses the generated default manifest without changing model semantics", () => {
    const manifest = parseModelManifest(defaultManifest);

    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.minSdkVersion).toBe("1.0.0");
    expect(manifest.input).toEqual({
      dtype: "float32",
      name: "pixel_values",
      shape: [1, 3, 800, 800]
    });
    expect(manifest.outputs.map(({ name, shape }) => ({ name, shape }))).toEqual([
      { name: "logits", shape: [1, 300, 25] },
      { name: "pred_boxes", shape: [1, 300, 4] },
      { name: "order_logits", shape: [1, 300, 300] },
      { name: "out_masks", shape: [1, 300, 200, 200] }
    ]);
    expect(manifest.labels[8]).toBe("footer");
    expect(manifest.labels[9]).toBe("footer");
    expect(manifest.preprocessing.size).toEqual({ height: 800, width: 800 });
    expect(
      manifest.variants.map(({ backendCompatibility, id, precision, url }) => ({
        backendCompatibility,
        id,
        precision,
        url
      }))
    ).toEqual([
      {
        backendCompatibility: ["wasm", "webgpu"],
        id: "fp16",
        precision: "fp16",
        url: "https://github.com/chenmohan123/web-sdk-PP-DocLayoutV3/releases/download/v1.0.0-models/model-fp16.onnx"
      },
      {
        backendCompatibility: ["wasm"],
        id: "fp32",
        precision: "fp32",
        url: "https://github.com/chenmohan123/web-sdk-PP-DocLayoutV3/releases/download/v1.0.0-models/model-fp32.onnx"
      }
    ]);
  });

  it("rejects an unknown schema version", () => {
    const manifest = copyManifest();
    manifest.schemaVersion = 2;

    expectManifestError(manifest, /schemaVersion/);
  });

  it("rejects a missing model output", () => {
    const manifest = copyManifest();
    manifest.outputs = (manifest.outputs as unknown[]).slice(0, -1);

    expectManifestError(manifest, /outputs/);
  });

  it("rejects a malformed SHA-256 digest", () => {
    const manifest = copyManifest();
    (manifest.variants as Array<Record<string, unknown>>)[0]!.sha256 = "not-a-sha256";

    expectManifestError(manifest, /sha256/);
  });

  it("rejects duplicate precision and backend coverage", () => {
    const manifest = copyManifest();
    const variants = manifest.variants as Array<Record<string, unknown>>;
    variants[1]!.precision = variants[0]!.precision;
    variants[1]!.backendCompatibility = variants[0]!.backendCompatibility;

    expectManifestError(manifest, /precision.*backend/i);
  });

  it("rejects a manifest requiring a newer SDK", () => {
    const manifest = copyManifest();
    manifest.minSdkVersion = "1.0.6";

    const error = captureManifestError(manifest);
    expect(error.code).toBe("MODEL_INCOMPATIBLE");
    expect(error.details).toEqual({
      currentSdkVersion: "1.0.5",
      minSdkVersion: "1.0.6"
    });
  });
});

describe("DocLayoutError", () => {
  it("serializes its stable code and details fields", () => {
    const error = new DocLayoutError("MODEL_DOWNLOAD_FAILED", "Download failed", {
      status: 503,
      url: "https://example.com/model.onnx"
    });

    expect(error.name).toBe("DocLayoutError");
    expect(error.message).toBe("Download failed");
    expect(JSON.parse(JSON.stringify(error))).toEqual({
      code: "MODEL_DOWNLOAD_FAILED",
      details: {
        status: 503,
        url: "https://example.com/model.onnx"
      },
      name: "DocLayoutError"
    });
  });
});
