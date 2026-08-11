import { DocLayoutError } from "../errors";

export interface ModelDownloadProgress {
  readonly loadedBytes: number;
  readonly totalBytes?: number;
}

export interface DownloadModelOptions {
  readonly fetch?: typeof fetch;
  readonly onProgress?: (progress: ModelDownloadProgress) => void;
  readonly signal?: AbortSignal;
}

export interface DownloadedModel {
  readonly data: ArrayBuffer;
  readonly downloadedBytes: number;
}

export async function downloadModel(
  url: string,
  options: DownloadModelOptions = {}
): Promise<DownloadedModel> {
  throwIfAborted(options.signal);
  const fetchImplementation = options.fetch ?? globalThis.fetch.bind(globalThis);
  let response: Response;
  try {
    response = await fetchImplementation(
      url,
      options.signal === undefined ? {} : { signal: options.signal }
    );
  } catch (cause) {
    if (options.signal?.aborted === true || isAbortError(cause)) {
      throw aborted(options.signal, cause);
    }
    throw new DocLayoutError(
      "MODEL_DOWNLOAD_FAILED",
      `Failed to download model from ${url}`,
      { url },
      { cause }
    );
  }

  if (!response.ok) {
    throw new DocLayoutError(
      "MODEL_DOWNLOAD_FAILED",
      `Model download failed with HTTP ${response.status}`,
      { status: response.status, statusText: response.statusText, url }
    );
  }

  const totalBytes = parseContentLength(response.headers.get("content-length"));
  if (response.body === null) {
    const data = await response.arrayBuffer();
    emitProgress(options.onProgress, data.byteLength, totalBytes);
    return { data, downloadedBytes: data.byteLength };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loadedBytes = 0;
  try {
    while (true) {
      const result = await readWithAbort(reader, options.signal);
      if (result.done) {
        break;
      }
      chunks.push(result.value);
      loadedBytes += result.value.byteLength;
      emitProgress(options.onProgress, loadedBytes, totalBytes);
    }
  } catch (cause) {
    if (cause instanceof DocLayoutError) {
      throw cause;
    }
    if (options.signal?.aborted === true || isAbortError(cause)) {
      throw aborted(options.signal, cause);
    }
    throw new DocLayoutError(
      "MODEL_DOWNLOAD_FAILED",
      `Failed while reading model response from ${url}`,
      { loadedBytes, url },
      { cause }
    );
  } finally {
    reader.releaseLock();
  }

  const combined = new Uint8Array(loadedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { data: combined.buffer, downloadedBytes: loadedBytes };
}

function emitProgress(
  onProgress: DownloadModelOptions["onProgress"],
  loadedBytes: number,
  totalBytes: number | undefined
): void {
  onProgress?.(totalBytes === undefined ? { loadedBytes } : { loadedBytes, totalBytes });
}

function parseContentLength(value: string | null): number | undefined {
  if (value === null) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

async function readWithAbort(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal === undefined) {
    return reader.read();
  }
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      void reader.cancel(signal.reason);
      reject(aborted(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    reader.read().then(
      (result) => {
        signal.removeEventListener("abort", onAbort);
        resolve(result);
      },
      (cause: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(cause instanceof Error ? cause : new Error("Model stream read failed", { cause }));
      }
    );
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) {
    throw aborted(signal);
  }
}

function aborted(signal?: AbortSignal, cause?: unknown): DocLayoutError {
  return new DocLayoutError(
    "ABORTED",
    "Model download was aborted",
    { reason: signal?.reason ?? "aborted" },
    cause === undefined ? undefined : { cause }
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
