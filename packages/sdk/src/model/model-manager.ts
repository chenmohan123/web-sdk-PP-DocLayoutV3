import { CacheStorageModelCache } from "../cache/cache-storage";
import { MemoryModelCache } from "../cache/memory-cache";
import type {
  ModelCache,
  ModelCacheEntry,
  ModelCacheIdentity,
  ModelCacheEstimate,
  ModelCacheMetadata
} from "../cache/model-cache";
import type { ModelManifest, ModelVariant } from "../types";
import { downloadModel, type ModelDownloadProgress } from "./download";
import { verifyModelIntegrity } from "./integrity";

export interface ModelManagerOptions {
  readonly fetch?: typeof fetch;
  readonly memoryCache?: ModelCache;
  readonly persistentCache?: ModelCache | null;
  readonly subtle?: SubtleCrypto;
  readonly now?: () => number;
}

export interface ModelLoadOptions {
  readonly onProgress?: (progress: ModelDownloadProgress) => void;
  readonly signal?: AbortSignal;
}

export interface LoadedModel {
  readonly data: ArrayBuffer;
  readonly downloadedBytes: number;
  readonly integrityMs: number;
  readonly modelCacheMs: number;
  readonly modelCacheReadMs: number;
  readonly modelDownloadMs: number;
  readonly modelSource: "cache" | "custom" | "memory" | "network";
  readonly source: "cache" | "network";
}

export class ModelManager {
  readonly #fetch: typeof fetch | undefined;
  readonly #memoryCache: ModelCache;
  readonly #persistentCache: ModelCache | undefined;
  readonly #subtle: SubtleCrypto | undefined;
  readonly #now: () => number;
  #generation = 0;
  readonly #modelGenerations = new Map<string, number>();
  #mutations: Promise<void> = Promise.resolve();

  constructor(options: ModelManagerOptions = {}) {
    this.#fetch = options.fetch;
    this.#memoryCache = options.memoryCache ?? new MemoryModelCache();
    this.#persistentCache =
      options.persistentCache === null
        ? undefined
        : (options.persistentCache ?? defaultPersistentCache());
    this.#subtle = options.subtle;
    this.#now =
      options.now ?? (() => (typeof performance === "object" ? performance.now() : Date.now()));
  }

  async load(
    manifest: ModelManifest,
    variant: ModelVariant,
    options: ModelLoadOptions = {}
  ): Promise<LoadedModel> {
    const key = modelCacheKey(manifest, variant);
    const identityKey = JSON.stringify([manifest.model.id, manifest.model.version]);
    const generation = this.#generation;
    const modelGeneration = this.#modelGenerations.get(identityKey) ?? 0;
    const canMutateCache = () =>
      generation === this.#generation &&
      modelGeneration === (this.#modelGenerations.get(identityKey) ?? 0);
    let modelCacheMs = 0;
    let integrityMs = 0;
    const timings = {
      addCache: (value: number) => {
        modelCacheMs += value;
      },
      addIntegrity: (value: number) => {
        integrityMs += value;
      }
    };
    const memoryEntry = await this.#readValid(
      this.#memoryCache,
      key,
      variant,
      canMutateCache,
      timings
    );
    if (memoryEntry !== undefined) {
      return {
        data: memoryEntry.data,
        downloadedBytes: 0,
        integrityMs,
        modelCacheMs,
        modelCacheReadMs: modelCacheMs,
        modelDownloadMs: 0,
        modelSource: "memory",
        source: "cache"
      };
    }

    if (this.#persistentCache !== undefined) {
      const persistentEntry = await this.#readValid(
        this.#persistentCache,
        key,
        variant,
        canMutateCache,
        timings
      );
      if (persistentEntry !== undefined) {
        return {
          data: persistentEntry.data,
          downloadedBytes: 0,
          integrityMs,
          modelCacheMs,
          modelCacheReadMs: modelCacheMs,
          modelDownloadMs: 0,
          modelSource: "cache",
          source: "cache"
        };
      }
    }

    const downloadStartedAt = this.#now();
    const downloaded = await downloadModel(variant.url, {
      ...(this.#fetch === undefined ? {} : { fetch: this.#fetch }),
      ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
      ...(options.signal === undefined ? {} : { signal: options.signal })
    });
    const modelDownloadMs = Math.max(0, this.#now() - downloadStartedAt);
    const integrityStartedAt = this.#now();
    await verifyModelIntegrity(downloaded.data, variant, this.#subtle);
    integrityMs += Math.max(0, this.#now() - integrityStartedAt);
    const entry: ModelCacheEntry = {
      bytes: downloaded.data.byteLength,
      data: downloaded.data,
      key,
      sha256: variant.sha256
    };

    await this.#mutate(async () => {
      // 清理使已启动的下载失效；写入与删除串行，避免清理后旧任务回填。
      if (!canMutateCache()) return;
      let persisted = false;
      if (this.#persistentCache !== undefined) {
        try {
          await this.#persistentCache.set(entry);
          persisted = true;
        } catch {
          persisted = false;
        }
      }
      if (!persisted) await this.#memoryCache.set(entry);
    });
    return {
      ...downloaded,
      integrityMs,
      modelCacheMs,
      modelCacheReadMs: modelCacheMs,
      modelDownloadMs,
      modelSource: "network",
      source: "network"
    };
  }

  clearCache(): Promise<void> {
    this.#generation += 1;
    return this.#clearMatching();
  }

  clearCurrentCache(identity: ModelCacheIdentity): Promise<void> {
    validateIdentity(identity);
    const identityKey = JSON.stringify([identity.modelId, identity.version]);
    this.#modelGenerations.set(identityKey, (this.#modelGenerations.get(identityKey) ?? 0) + 1);
    return this.#clearMatching(identity);
  }

  async estimateCache(identity?: ModelCacheIdentity): Promise<ModelCacheEstimate> {
    if (identity !== undefined) validateIdentity(identity);
    await this.#mutations;
    const memory = (await metadata(this.#memoryCache)).filter((entry) =>
      matchesIdentity(entry.key, identity)
    );
    const persistent =
      this.#persistentCache === undefined
        ? []
        : (await metadata(this.#persistentCache)).filter((entry) =>
            matchesIdentity(entry.key, identity)
          );
    const memoryBytes = memory.reduce((sum, entry) => sum + entry.bytes, 0);
    const persistentBytes = persistent.reduce((sum, entry) => sum + entry.bytes, 0);
    let origin: StorageEstimate | undefined;
    try {
      origin = typeof navigator === "undefined" ? undefined : await navigator.storage?.estimate();
    } catch {
      /* 源站配额不可用时仍返回 SDK 可测容量。 */
    }
    return {
      bytes: memoryBytes + persistentBytes,
      memoryBytes,
      persistentBytes,
      entryCount: new Set([...memory, ...persistent].map((entry) => entry.key)).size,
      ...(origin?.usage === undefined ? {} : { originUsageBytes: origin.usage }),
      ...(origin?.quota === undefined ? {} : { originQuotaBytes: origin.quota })
    };
  }

  #clearMatching(identity?: ModelCacheIdentity): Promise<void> {
    return this.#mutate(async () => {
      for (const cache of [this.#memoryCache, this.#persistentCache]) {
        if (cache === undefined) continue;
        for (const entry of await metadata(cache)) {
          if (matchesIdentity(entry.key, identity)) await cache.delete(entry.key);
        }
      }
    });
  }

  #mutate(operation: () => Promise<void>): Promise<void> {
    const pending = this.#mutations.then(operation);
    this.#mutations = pending.catch(() => undefined);
    return pending;
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
    variant: ModelVariant,
    canMutateCache: () => boolean,
    timings?: { addCache(value: number): void; addIntegrity(value: number): void }
  ): Promise<ModelCacheEntry | undefined> {
    let entry: ModelCacheEntry | undefined;
    const cacheStartedAt = this.#now();
    try {
      entry = await cache.get(key);
    } catch {
      return undefined;
    } finally {
      timings?.addCache(Math.max(0, this.#now() - cacheStartedAt));
    }
    if (entry === undefined) {
      return undefined;
    }
    const integrityStartedAt = this.#now();
    try {
      await verifyModelIntegrity(entry.data, variant, this.#subtle);
      timings?.addIntegrity(Math.max(0, this.#now() - integrityStartedAt));
      return entry;
    } catch {
      timings?.addIntegrity(Math.max(0, this.#now() - integrityStartedAt));
      await this.#mutate(async () => {
        // 旧校验不能删除清理后由新任务写入的有效缓存。
        if (canMutateCache()) await cache.delete(key);
      });
      return undefined;
    }
  }
}

export function modelCacheKey(manifest: ModelManifest, variant: ModelVariant): string {
  const parts = [manifest.model.id, manifest.model.version, variant.id, variant.sha256];
  // 普通身份保留旧键；特殊身份使用显式版本，避免将历史百分号文本误认成编码。
  return parts.some((part) => /[:%]/u.test(part))
    ? ["ppdoclayout-v2", ...parts.map(encodeURIComponent)].join(":")
    : ["ppdoclayout", ...parts].join(":");
}

function validateIdentity(identity: ModelCacheIdentity): void {
  if (!identity.modelId || !identity.version)
    throw new TypeError("模型缓存身份必须包含 modelId 与 version");
}

function matchesIdentity(key: string, identity?: ModelCacheIdentity): boolean {
  const parts = key.split(":");
  if (parts[0] !== "ppdoclayout" && parts[0] !== "ppdoclayout-v2") return false;
  if (identity === undefined) return true;
  if (parts.length !== 5) return false;
  if (parts[0] === "ppdoclayout")
    return parts[1] === identity.modelId && parts[2] === identity.version;
  try {
    return (
      decodeURIComponent(parts[1]!) === identity.modelId &&
      decodeURIComponent(parts[2]!) === identity.version
    );
  } catch {
    return false;
  }
}

function metadata(cache: ModelCache): Promise<readonly ModelCacheMetadata[]> {
  return cache.listMetadata?.() ?? cache.list();
}

function defaultPersistentCache(): ModelCache | undefined {
  return typeof caches === "undefined" ? undefined : new CacheStorageModelCache(caches);
}
