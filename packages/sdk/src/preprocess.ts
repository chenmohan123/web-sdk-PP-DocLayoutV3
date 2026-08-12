import { DocLayoutError } from "./errors";
import type { NormalizedRaster, PreprocessingConfig } from "./types";

export interface PreprocessedImage {
  readonly data: Float32Array;
  readonly dims: readonly [1, 3, number, number];
  readonly originalSize: Readonly<{ height: number; width: number }>;
}

export interface PreprocessOptions {
  readonly signal?: AbortSignal;
}

const CUBIC_A = -0.75;

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DocLayoutError("ABORTED", "Image preprocessing was aborted", {
      reason: signal.reason
    });
  }
}

function cubicWeight(distance: number): number {
  const value = Math.abs(distance);
  if (value <= 1) {
    return (CUBIC_A + 2) * value ** 3 - (CUBIC_A + 3) * value ** 2 + 1;
  }
  if (value < 2) {
    return CUBIC_A * value ** 3 - 5 * CUBIC_A * value ** 2 + 8 * CUBIC_A * value - 4 * CUBIC_A;
  }
  return 0;
}

interface AxisSample {
  readonly indices: readonly [number, number, number, number];
  readonly weights: readonly [number, number, number, number];
}

function buildAxisSamples(sourceSize: number, targetSize: number): AxisSample[] {
  const scale = sourceSize / targetSize;
  return Array.from({ length: targetSize }, (_, target) => {
    const source = (target + 0.5) * scale - 0.5;
    const base = Math.floor(source);
    const indices = [-1, 0, 1, 2].map((offset) =>
      Math.min(sourceSize - 1, Math.max(0, base + offset))
    ) as unknown as AxisSample["indices"];
    const weights = [-1, 0, 1, 2].map((offset) =>
      cubicWeight(source - (base + offset))
    ) as unknown as AxisSample["weights"];
    return { indices, weights };
  });
}

function saturateUint8(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

function resizedChannel(
  raster: NormalizedRaster,
  channel: number,
  targetWidth: number,
  targetHeight: number,
  signal: AbortSignal | undefined
): Float64Array {
  const xSamples = buildAxisSamples(raster.width, targetWidth);
  const ySamples = buildAxisSamples(raster.height, targetHeight);
  const horizontal = new Float64Array(raster.height * targetWidth);

  for (let y = 0; y < raster.height; y += 1) {
    throwIfAborted(signal);
    for (let x = 0; x < targetWidth; x += 1) {
      const sample = xSamples[x]!;
      let value = 0;
      for (let index = 0; index < 4; index += 1) {
        value +=
          raster.rgba[(y * raster.width + sample.indices[index]!) * 4 + channel]! *
          sample.weights[index]!;
      }
      // The official torchvision processor resizes uint8 input. Its separable
      // integer path saturates between the horizontal and vertical passes.
      horizontal[y * targetWidth + x] = saturateUint8(value);
    }
  }

  const resized = new Float64Array(targetWidth * targetHeight);
  for (let y = 0; y < targetHeight; y += 1) {
    throwIfAborted(signal);
    const sample = ySamples[y]!;
    for (let x = 0; x < targetWidth; x += 1) {
      let value = 0;
      for (let index = 0; index < 4; index += 1) {
        value += horizontal[sample.indices[index]! * targetWidth + x]! * sample.weights[index]!;
      }
      resized[y * targetWidth + x] = saturateUint8(value);
    }
  }
  return resized;
}

function validateRaster(raster: NormalizedRaster): void {
  if (
    raster.width <= 0 ||
    raster.height <= 0 ||
    raster.rgba.length !== raster.width * raster.height * 4
  ) {
    throw new DocLayoutError("IMAGE_INVALID", "Image raster dimensions or pixel data are invalid", {
      height: raster.height,
      rgbaLength: raster.rgba.length,
      width: raster.width
    });
  }
}

export function preprocessRaster(
  raster: NormalizedRaster,
  config: PreprocessingConfig,
  options: PreprocessOptions = {}
): PreprocessedImage {
  throwIfAborted(options.signal);
  validateRaster(raster);

  const targetHeight = config.doResize ? config.size.height : raster.height;
  const targetWidth = config.doResize ? config.size.width : raster.width;
  if (targetWidth <= 0 || targetHeight <= 0) {
    throw new DocLayoutError("IMAGE_INVALID", "Preprocessing target dimensions are invalid", {
      height: targetHeight,
      width: targetWidth
    });
  }

  const plane = targetWidth * targetHeight;
  const data = new Float32Array(plane * 3);
  for (let channel = 0; channel < 3; channel += 1) {
    const pixels = config.doResize
      ? resizedChannel(raster, channel, targetWidth, targetHeight, options.signal)
      : undefined;
    const mean = config.imageMean[channel];
    const std = config.imageStd[channel];
    if (config.doNormalize && std === 0) {
      throw new DocLayoutError(
        "MANIFEST_INVALID",
        "Image normalization standard deviation is zero",
        {
          channel
        }
      );
    }

    for (let index = 0; index < plane; index += 1) {
      const source = pixels?.[index] ?? raster.rgba[index * 4 + channel]!;
      const rescaled = config.doRescale ? source * config.rescaleFactor : source;
      data[channel * plane + index] = config.doNormalize ? (rescaled - mean!) / std! : rescaled;
    }
  }

  throwIfAborted(options.signal);
  return {
    data,
    dims: [1, 3, targetHeight, targetWidth],
    originalSize: { height: raster.height, width: raster.width }
  };
}
