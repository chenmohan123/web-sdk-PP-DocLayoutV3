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
  listMetadata?(): Promise<readonly ModelCacheMetadata[]>;
  set(entry: ModelCacheEntry): Promise<void>;
}

export type ModelCacheMetadata = Omit<ModelCacheEntry, "data">;

export interface ModelCacheIdentity {
  readonly modelId: string;
  readonly version: string;
}

export interface ModelCacheEstimate {
  readonly bytes: number;
  readonly memoryBytes: number;
  readonly persistentBytes: number;
  readonly entryCount: number;
  readonly originUsageBytes?: number;
  readonly originQuotaBytes?: number;
}

export function cloneCacheEntry(entry: ModelCacheEntry): ModelCacheEntry {
  return { ...entry, data: entry.data.slice(0) };
}
