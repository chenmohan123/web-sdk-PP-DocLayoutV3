import { DocLayoutError } from "../errors";
import type { DocLayoutCapabilities } from "../types";

interface WebGpuAdapterLike {
  readonly features: ReadonlySet<string>;
}

export interface CapabilityEnvironment {
  readonly crossOriginIsolated: boolean;
  readonly requestAdapter?: () => Promise<WebGpuAdapterLike | null>;
  readonly sharedArrayBuffer: boolean;
  readonly validateWasm?: (bytes: BufferSource) => boolean;
  readonly wasm?: boolean;
  readonly worker: boolean;
}

export interface CapabilityProbeOptions {
  readonly signal?: AbortSignal;
}

const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 10, 30, 1, 28, 0, 65, 0, 253, 15, 253,
  12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 253, 186, 1, 26, 11
]);

const THREADS_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 5, 4, 1, 3, 1, 1, 10, 11, 1, 9, 0, 65,
  0, 254, 16, 2, 0, 26, 11
]);

export async function probeCapabilities(
  environment?: CapabilityEnvironment,
  options: CapabilityProbeOptions = {}
): Promise<DocLayoutCapabilities> {
  const runtime = environment ?? readGlobalEnvironment();
  throwIfAborted(options.signal);

  const diagnostics: string[] = [];
  let adapter: WebGpuAdapterLike | null = null;
  if (runtime.requestAdapter === undefined) {
    diagnostics.push("webgpu: unavailable because navigator.gpu is missing");
  } else {
    try {
      adapter = await abortable(runtime.requestAdapter(), options.signal);
      diagnostics.push(
        adapter === null
          ? "webgpu: unavailable because no adapter was returned"
          : "webgpu: supported by an acquired adapter"
      );
    } catch (error) {
      if (error instanceof DocLayoutError && error.code === "ABORTED") {
        throw error;
      }
      diagnostics.push(`webgpu: adapter request failed (${errorMessage(error)})`);
    }
  }

  const webgpu = adapter !== null;
  const webgpuFp16 = adapter?.features.has("shader-f16") === true;
  diagnostics.push(
    webgpuFp16 ? "webgpu-fp16: shader-f16 is supported" : "webgpu-fp16: shader-f16 is unavailable"
  );

  const wasm = runtime.wasm ?? runtime.validateWasm !== undefined;
  const wasmSimd = wasm && validateFeature(runtime.validateWasm, SIMD_PROBE);
  const wasmThreads =
    wasm &&
    runtime.crossOriginIsolated &&
    runtime.sharedArrayBuffer &&
    validateFeature(runtime.validateWasm, THREADS_PROBE);
  diagnostics.push(wasm ? "wasm: supported" : "wasm: unavailable");
  diagnostics.push(wasmSimd ? "wasm-simd: supported" : "wasm-simd: unavailable");
  diagnostics.push(
    wasmThreads
      ? "wasm-threads: supported"
      : "wasm-threads: unavailable (requires shared memory and cross-origin isolation)"
  );
  diagnostics.push(
    runtime.worker ? "worker: supported" : "worker: unavailable in this environment"
  );

  return {
    crossOriginIsolated: runtime.crossOriginIsolated,
    diagnostics,
    wasm,
    wasmSimd,
    wasmThreads,
    webgpu,
    webgpuFp16,
    worker: runtime.worker
  };
}

function readGlobalEnvironment(): CapabilityEnvironment {
  const runtimeNavigator = globalThis.navigator as Navigator & {
    gpu?: {
      requestAdapter(options?: {
        powerPreference?: "high-performance";
      }): Promise<WebGpuAdapterLike | null>;
    };
  };
  const wasm = typeof WebAssembly === "object";
  return {
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
    ...(runtimeNavigator.gpu === undefined
      ? {}
      : {
          requestAdapter: () =>
            runtimeNavigator.gpu!.requestAdapter({ powerPreference: "high-performance" })
        }),
    sharedArrayBuffer: typeof SharedArrayBuffer === "function",
    ...(wasm ? { validateWasm: (bytes: BufferSource) => WebAssembly.validate(bytes) } : {}),
    wasm,
    worker: typeof Worker === "function"
  };
}

function validateFeature(
  validateWasm: CapabilityEnvironment["validateWasm"],
  bytes: BufferSource
): boolean {
  if (validateWasm === undefined) {
    return false;
  }
  try {
    return validateWasm(bytes);
  } catch {
    return false;
  }
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) {
    return promise;
  }
  throwIfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(aborted(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(
          error instanceof Error
            ? error
            : new Error("WebGPU adapter request failed", { cause: error })
        );
      }
    );
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) {
    throw aborted(signal);
  }
}

function aborted(signal: AbortSignal): DocLayoutError {
  return new DocLayoutError("ABORTED", "Capability probing was aborted", {
    reason: signal.reason ?? "aborted"
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
