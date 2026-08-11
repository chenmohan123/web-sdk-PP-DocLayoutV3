import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { MemoryModelCache } from "../src/cache/memory-cache";
import type { ModelCache, ModelCacheEntry } from "../src/cache/model-cache";
import { DocLayoutError } from "../src/errors";
import { parseModelManifest } from "../src/model/manifest";
import { ModelManager, modelCacheKey } from "../src/model/model-manager";
import type { ModelManifest, ModelVariant } from "../src/types";

const defaultManifest = parseModelManifest(
  JSON.parse(
    readFileSync(
      new URL("../../../models/pp-doclayoutv3/1.0.0/manifest.json", import.meta.url),
      "utf8"
    )
  )
);

class RecordingCache implements ModelCache {
  readonly deleted: string[] = [];
  readonly entries = new Map<string, ModelCacheEntry>();
  failWrites = false;

  clear(): Promise<void> {
    this.entries.clear();
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.deleted.push(key);
    this.entries.delete(key);
    return Promise.resolve();
  }

  get(key: string): Promise<ModelCacheEntry | undefined> {
    return Promise.resolve(this.entries.get(key));
  }

  list(): Promise<readonly ModelCacheEntry[]> {
    return Promise.resolve([...this.entries.values()]);
  }

  set(entry: ModelCacheEntry): Promise<void> {
    if (this.failWrites) {
      return Promise.reject(new DOMException("quota exceeded", "QuotaExceededError"));
    }
    this.entries.set(entry.key, entry);
    return Promise.resolve();
  }
}

async function sha256(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(data).buffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function modelFixture(text = "validated-model-bytes"): Promise<{
  data: Uint8Array;
  manifest: ModelManifest;
  variant: ModelVariant;
}> {
  const data = new TextEncoder().encode(text);
  const variant: ModelVariant = {
    ...defaultManifest.variants[1]!,
    bytes: data.byteLength,
    sha256: await sha256(data),
    url: "https://models.example.test/model.onnx"
  };
  return { data, manifest: defaultManifest, variant };
}

function streamingResponse(
  chunks: readonly Uint8Array[],
  contentLength: number | null = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    }
  });
  return new Response(stream, {
    headers: contentLength === null ? {} : { "content-length": String(contentLength) },
    status: 200
  });
}

describe("ModelManager", () => {
  it("streams a cold download with monotonically increasing progress", async () => {
    const { data, manifest, variant } = await modelFixture();
    const progress: Array<{ loadedBytes: number; totalBytes?: number }> = [];
    let fetches = 0;
    const manager = new ModelManager({
      fetch: () => {
        fetches += 1;
        return Promise.resolve(
          streamingResponse([data.slice(0, 4), data.slice(4, 11), data.slice(11)])
        );
      },
      persistentCache: new RecordingCache()
    });

    const result = await manager.load(manifest, variant, {
      onProgress: (event) => progress.push(event)
    });

    expect(fetches).toBe(1);
    expect(result.source).toBe("network");
    expect(result.downloadedBytes).toBe(data.byteLength);
    expect(new Uint8Array(result.data)).toEqual(data);
    expect(progress.map(({ loadedBytes }) => loadedBytes)).toEqual([4, 11, data.byteLength]);
    expect(progress.every(({ totalBytes }) => totalBytes === data.byteLength)).toBe(true);
  });

  it("uses a valid warm cache entry without downloading bytes", async () => {
    const { data, manifest, variant } = await modelFixture();
    const cache = new RecordingCache();
    const key = modelCacheKey(manifest, variant);
    await cache.set({
      key,
      data: Uint8Array.from(data).buffer,
      sha256: variant.sha256,
      bytes: data.byteLength
    });
    let fetches = 0;
    const manager = new ModelManager({
      fetch: () => {
        fetches += 1;
        return Promise.reject(new Error("unexpected fetch"));
      },
      persistentCache: cache
    });

    const result = await manager.load(manifest, variant);

    expect(fetches).toBe(0);
    expect(result).toMatchObject({ source: "cache", downloadedBytes: 0 });
    expect(new Uint8Array(result.data)).toEqual(data);
  });

  it("evicts a corrupt cache entry before downloading a valid replacement", async () => {
    const { data, manifest, variant } = await modelFixture();
    const cache = new RecordingCache();
    const key = modelCacheKey(manifest, variant);
    const corrupt = new TextEncoder().encode("corrupt");
    await cache.set({
      key,
      data: corrupt.buffer.slice(0),
      sha256: variant.sha256,
      bytes: corrupt.byteLength
    });
    const manager = new ModelManager({
      fetch: () => Promise.resolve(streamingResponse([data])),
      persistentCache: cache
    });

    const result = await manager.load(manifest, variant);

    expect(cache.deleted).toContain(key);
    expect(result.source).toBe("network");
    expect(new Uint8Array(cache.entries.get(key)!.data)).toEqual(data);
  });

  it("reports unknown content length without inventing a total", async () => {
    const { data, manifest, variant } = await modelFixture();
    const progress: Array<{ loadedBytes: number; totalBytes?: number }> = [];
    const manager = new ModelManager({
      fetch: () => Promise.resolve(streamingResponse([data.slice(0, 2), data.slice(2)], null))
    });

    await manager.load(manifest, variant, { onProgress: (event) => progress.push(event) });

    expect(progress.length).toBe(2);
    expect(progress.every((event) => event.totalBytes === undefined)).toBe(true);
  });

  it("maps aborts to the stable ABORTED error", async () => {
    const { manifest, variant } = await modelFixture();
    const controller = new AbortController();
    const manager = new ModelManager({
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true }
          );
        })
    });
    const pending = manager.load(manifest, variant, { signal: controller.signal });

    controller.abort("user cancelled");

    await expect(pending).rejects.toMatchObject({
      code: "ABORTED",
      details: { reason: "user cancelled" }
    });
  });

  it("preserves the cause of HTTP and CORS-like download failures", async () => {
    const { manifest, variant } = await modelFixture();
    const cause = new TypeError("Failed to fetch");
    const manager = new ModelManager({ fetch: () => Promise.reject(cause) });

    let error: unknown;
    try {
      await manager.load(manifest, variant);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(DocLayoutError);
    expect(error).toMatchObject({ code: "MODEL_DOWNLOAD_FAILED", cause });
  });

  it("falls back to memory when persistent cache writes exceed quota", async () => {
    const { data, manifest, variant } = await modelFixture();
    const persistent = new RecordingCache();
    persistent.failWrites = true;
    const memory = new MemoryModelCache();
    let fetches = 0;
    const manager = new ModelManager({
      fetch: () => {
        fetches += 1;
        return Promise.resolve(streamingResponse([data]));
      },
      memoryCache: memory,
      persistentCache: persistent
    });

    expect((await manager.load(manifest, variant)).source).toBe("network");
    expect((await manager.load(manifest, variant)).source).toBe("cache");
    expect(fetches).toBe(1);
  });

  it("lists and clears cache entries across adapters", async () => {
    const { data, manifest, variant } = await modelFixture();
    const persistent = new RecordingCache();
    const memory = new MemoryModelCache();
    const manager = new ModelManager({
      fetch: () => Promise.resolve(streamingResponse([data])),
      memoryCache: memory,
      persistentCache: persistent
    });
    await manager.load(manifest, variant);

    expect(await manager.listCache()).toHaveLength(1);
    await manager.clearCache();
    expect(await manager.listCache()).toEqual([]);
  });
});
