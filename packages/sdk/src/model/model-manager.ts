import { CacheStorageModelCache } from "../cache/cache-storage";
import { MemoryModelCache } from "../cache/memory-cache";
import type { ModelCache, ModelCacheEntry } from "../cache/model-cache";
import type { ModelManifest, ModelVariant } from "../types";
import { downloadModel, type ModelDownloadProgress } from "./download";
import { verifyModelIntegrity } from "./integrity";

export interface ModelManagerOptions {
  readonly fetch?: typeof fetch;
  readonly memoryCache?: ModelCache;
  readonly persistentCache?: ModelCache | null;
  readonly subtle?: SubtleCrypto;
}

export interface ModelLoadOptions {
  readonly onProgress?: (progress: ModelDownloadProgress) => void;
  readonly signal?: AbortSignal;
}

export interface LoadedModel {
  readonly data: ArrayBuffer;
  readonly downloadedBytes: number;
  readonly source: "cache" | "network";
}

export class ModelManager {
  readonly #fetch: typeof fetch | undefined;
  readonly #memoryCache: ModelCache;
  readonly #persistentCache: ModelCache | undefined;
  readonly #subtle: SubtleCrypto | undefined;

  constructor(options: ModelManagerOptions = {}) {
    this.#fetch = options.fetch;
    this.#memoryCache = options.memoryCache ?? new MemoryModelCache();
    this.#persistentCache =
      options.persistentCache === null
        ? undefined
        : (options.persistentCache ?? defaultPersistentCache());
    this.#subtle = options.subtle;
  }

  async load(
    manifest: ModelManifest,
    variant: ModelVariant,
    options: ModelLoadOptions = {}
  ): Promise<LoadedModel> {
    const key = modelCacheKey(manifest, variant);
    const memoryEntry = await this.#readValid(this.#memoryCache, key, variant);
    if (memoryEntry !== undefined) {
      return { data: memoryEntry.data, downloadedBytes: 0, source: "cache" };
    }

    if (this.#persistentCache !== undefined) {
      const persistentEntry = await this.#readValid(this.#persistentCache, key, variant);
      if (persistentEntry !== undefined) {
        return { data: persistentEntry.data, downloadedBytes: 0, source: "cache" };
      }
    }

    const downloaded = await downloadModel(variant.url, {
      ...(this.#fetch === undefined ? {} : { fetch: this.#fetch }),
      ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
      ...(options.signal === undefined ? {} : { signal: options.signal })
    });
    await verifyModelIntegrity(downloaded.data, variant, this.#subtle);
    const entry: ModelCacheEntry = {
      bytes: downloaded.data.byteLength,
      data: downloaded.data,
      key,
      sha256: variant.sha256
    };

    let persisted = false;
    if (this.#persistentCache !== undefined) {
      try {
        await this.#persistentCache.set(entry);
        persisted = true;
      } catch {
        persisted = false;
      }
    }
    if (!persisted) {
      await this.#memoryCache.set(entry);
    }
    return { ...downloaded, source: "network" };
  }

  async clearCache(): Promise<void> {
    await this.#memoryCache.clear();
    if (this.#persistentCache !== undefined) {
      await this.#persistentCache.clear();
    }
  }

  async listCache(): Promise<readonly ModelCacheEntry[]> {
    const entries = new Map<string, ModelCacheEntry>();
    for (const entry of await this.#memoryCache.list()) {
      entries.set(entry.key, entry);
    }
    if (this.#persistentCache !== undefined) {
      for (const entry of await this.#persistentCache.list()) {
        entries.set(entry.key, entry);
      }
    }
    return [...entries.values()];
  }

  async #readValid(
    cache: ModelCache,
    key: string,
    variant: ModelVariant
  ): Promise<ModelCacheEntry | undefined> {
    let entry: ModelCacheEntry | undefined;
    try {
      entry = await cache.get(key);
    } catch {
      return undefined;
    }
    if (entry === undefined) {
      return undefined;
    }
    try {
      await verifyModelIntegrity(entry.data, variant, this.#subtle);
      return entry;
    } catch {
      await cache.delete(key);
      return undefined;
    }
  }
}

export function modelCacheKey(manifest: ModelManifest, variant: ModelVariant): string {
  return [
    "ppdoclayout",
    manifest.model.id,
    manifest.model.version,
    variant.id,
    variant.sha256
  ].join(":");
}

function defaultPersistentCache(): ModelCache | undefined {
  return typeof caches === "undefined" ? undefined : new CacheStorageModelCache(caches);
}
