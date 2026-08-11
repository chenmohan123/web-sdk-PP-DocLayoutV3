export interface ModelCacheEntry {
  readonly bytes: number;
  readonly data: ArrayBuffer;
  readonly key: string;
  readonly sha256: string;
}

export interface ModelCache {
  clear(): Promise<void>;
  delete(key: string): Promise<void>;
  get(key: string): Promise<ModelCacheEntry | undefined>;
  list(): Promise<readonly ModelCacheEntry[]>;
  set(entry: ModelCacheEntry): Promise<void>;
}

export function cloneCacheEntry(entry: ModelCacheEntry): ModelCacheEntry {
  return { ...entry, data: entry.data.slice(0) };
}
