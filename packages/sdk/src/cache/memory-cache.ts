import { cloneCacheEntry, type ModelCache, type ModelCacheEntry } from "./model-cache";

export class MemoryModelCache implements ModelCache {
  readonly #entries = new Map<string, ModelCacheEntry>();

  clear(): Promise<void> {
    this.#entries.clear();
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.#entries.delete(key);
    return Promise.resolve();
  }

  get(key: string): Promise<ModelCacheEntry | undefined> {
    const entry = this.#entries.get(key);
    return Promise.resolve(entry === undefined ? undefined : cloneCacheEntry(entry));
  }

  list(): Promise<readonly ModelCacheEntry[]> {
    return Promise.resolve([...this.#entries.values()].map(cloneCacheEntry));
  }

  set(entry: ModelCacheEntry): Promise<void> {
    this.#entries.set(entry.key, cloneCacheEntry(entry));
    return Promise.resolve();
  }
}
