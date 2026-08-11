import { DocLayoutError } from "../errors";
import type { NormalizedRaster } from "../types";

interface DrawableImage {
  readonly height: number;
  readonly width: number;
  close?(): void;
}

interface RasterContext {
  drawImage(source: CanvasImageSource, dx: number, dy: number): void;
  getImageData(sx: number, sy: number, sw: number, sh: number): { data: Uint8ClampedArray };
}

interface RasterCanvas {
  getContext(contextId: "2d", options?: CanvasRenderingContext2DSettings): RasterContext | null;
}

export interface DecodeEnvironment {
  readonly createCanvas?: (width: number, height: number) => RasterCanvas;
  readonly createImageBitmap?: (source: ImageBitmapSource) => Promise<DrawableImage>;
  readonly signal?: AbortSignal;
}

export type DecodableImage = Blob | CanvasImageSource | NormalizedRaster;

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DocLayoutError("ABORTED", "Image decoding was aborted", {
      reason: signal.reason
    });
  }
}

function isNormalizedRaster(input: DecodableImage): input is NormalizedRaster {
  return (
    typeof input === "object" &&
    input !== null &&
    "rgba" in input &&
    input.rgba instanceof Uint8ClampedArray
  );
}

function validateRaster(raster: NormalizedRaster): NormalizedRaster {
  if (
    !Number.isInteger(raster.width) ||
    !Number.isInteger(raster.height) ||
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

  return raster;
}

function sourceSize(source: CanvasImageSource): { height: number; width: number } {
  if (typeof HTMLImageElement !== "undefined" && source instanceof HTMLImageElement) {
    return { height: source.naturalHeight, width: source.naturalWidth };
  }

  if (typeof SVGImageElement !== "undefined" && source instanceof SVGImageElement) {
    return {
      height: source.height.baseVal.value,
      width: source.width.baseVal.value
    };
  }

  const sized = source as unknown as {
    height?: number;
    videoHeight?: number;
    videoWidth?: number;
    width?: number;
  };
  return {
    height: sized.videoHeight ?? sized.height ?? 0,
    width: sized.videoWidth ?? sized.width ?? 0
  };
}

function defaultCreateCanvas(width: number, height: number): RasterCanvas {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }

  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  throw new DocLayoutError("IMAGE_INVALID", "No canvas implementation is available");
}

export async function decodeImage(
  input: DecodableImage,
  environment: DecodeEnvironment = {}
): Promise<NormalizedRaster> {
  throwIfAborted(environment.signal);

  if (isNormalizedRaster(input)) {
    return validateRaster(input);
  }

  let source: DrawableImage | CanvasImageSource;
  let ownedBitmap: DrawableImage | undefined;

  try {
    if (input instanceof Blob) {
      const createBitmap = environment.createImageBitmap ?? globalThis.createImageBitmap;
      if (typeof createBitmap !== "function") {
        throw new DocLayoutError("IMAGE_INVALID", "ImageBitmap decoding is unavailable");
      }
      ownedBitmap = await createBitmap(input);
      source = ownedBitmap;
    } else {
      source = input;
    }

    throwIfAborted(environment.signal);
    const { height, width } = sourceSize(source as CanvasImageSource);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new DocLayoutError("IMAGE_INVALID", "Decoded image has invalid dimensions", {
        height,
        width
      });
    }

    const canvas = (environment.createCanvas ?? defaultCreateCanvas)(width, height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) {
      throw new DocLayoutError("IMAGE_INVALID", "Unable to create a 2D canvas context");
    }

    context.drawImage(source as CanvasImageSource, 0, 0);
    const rgba = new Uint8ClampedArray(context.getImageData(0, 0, width, height).data);
    throwIfAborted(environment.signal);
    return validateRaster({ height, rgba, width });
  } catch (error) {
    if (error instanceof DocLayoutError) {
      throw error;
    }
    throw new DocLayoutError("IMAGE_INVALID", "Unable to decode image", {}, { cause: error });
  } finally {
    ownedBitmap?.close?.();
  }
}
