import reference from "./fixtures/preprocess-reference.json";

import { describe, expect, it, vi } from "vitest";

import { decodeImage } from "../src/image/decode";
import { preprocessRaster } from "../src/preprocess";
import type { NormalizedRaster, PreprocessingConfig } from "../src/types";

const processor = {
  ...reference.processor,
  imageMean: reference.processor.imageMean as [number, number, number],
  imageStd: reference.processor.imageStd as [number, number, number]
} satisfies PreprocessingConfig;

function sourceRaster(): NormalizedRaster {
  const rgba = new Uint8ClampedArray(reference.source.width * reference.source.height * 4);
  let offset = 0;
  for (const row of reference.source.rgbRows) {
    for (const pixel of row) {
      rgba[offset++] = pixel[0]!;
      rgba[offset++] = pixel[1]!;
      rgba[offset++] = pixel[2]!;
      rgba[offset++] = 255;
    }
  }
  return { height: reference.source.height, rgba, width: reference.source.width };
}

describe("preprocessRaster", () => {
  it("produces the official Float32 NCHW tensor and preserves original dimensions", () => {
    const result = preprocessRaster(sourceRaster(), processor);

    expect(result.data).toBeInstanceOf(Float32Array);
    expect(result.dims).toEqual([1, 3, 800, 800]);
    expect(result.originalSize).toEqual({ height: 2, width: 3 });
    expect(result.data).toHaveLength(3 * 800 * 800);
  });

  it("matches official bicubic interpolation and 1/255 scaling at sampled pixels", () => {
    const { data } = preprocessRaster(sourceRaster(), processor);
    const plane = 800 * 800;

    for (const sample of reference.tensor.samples) {
      for (let channel = 0; channel < 3; channel += 1) {
        const actual = data[channel * plane + sample.y * 800 + sample.x]! * 255;
        expect(actual).toBeCloseTo(sample.rgb255[channel]!, 4);
      }
    }
  });

  it("keeps RGB channel order when converting interleaved RGBA to NCHW", () => {
    const { data } = preprocessRaster(sourceRaster(), processor);
    const plane = 800 * 800;

    expect(data[0]).toBe(1);
    expect(data[plane]).toBe(0);
    expect(data[plane * 2]).toBe(0);
  });

  it("rejects zero-size rasters", () => {
    let error: unknown;
    try {
      preprocessRaster({ height: 0, rgba: new Uint8ClampedArray(), width: 0 }, processor);
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({ code: "IMAGE_INVALID" });
  });

  it("honors an already-aborted signal", () => {
    const controller = new AbortController();
    controller.abort("cancelled");

    let error: unknown;
    try {
      preprocessRaster(sourceRaster(), processor, { signal: controller.signal });
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({ code: "ABORTED", details: { reason: "cancelled" } });
  });
});

describe("decodeImage", () => {
  it("closes an internally created ImageBitmap after reading pixels", async () => {
    const close = vi.fn();
    const drawImage = vi.fn();
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });

    const raster = await decodeImage(blob, {
      createCanvas: () => ({
        getContext: () => ({
          drawImage,
          getImageData: () => ({ data: new Uint8ClampedArray([10, 20, 30, 255]) })
        })
      }),
      createImageBitmap: () => Promise.resolve({ close, height: 1, width: 1 })
    });

    expect(raster).toEqual({
      height: 1,
      rgba: new Uint8ClampedArray([10, 20, 30, 255]),
      width: 1
    });
    expect(drawImage).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it("rejects decoding when already aborted", async () => {
    const controller = new AbortController();
    controller.abort("cancelled");

    await expect(
      decodeImage(new Blob(), {
        createCanvas: () => {
          throw new Error("must not create canvas");
        },
        createImageBitmap: () => Promise.reject(new Error("must not decode")),
        signal: controller.signal
      })
    ).rejects.toMatchObject({ code: "ABORTED", details: { reason: "cancelled" } });
  });
});
