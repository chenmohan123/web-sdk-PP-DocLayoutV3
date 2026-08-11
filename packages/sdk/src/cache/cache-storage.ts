import type { ModelCache, ModelCacheEntry } from "./model-cache";

const CACHE_ORIGIN = "https://cache.ppdoclayout.invalid/";

export class CacheStorageModelCache implements ModelCache {
  constructor(
    private readonly storage: CacheStorage,
    private readonly cacheName = "ppdoclayout-models-v1"
  ) {}

  async clear(): Promise<void> {
    await this.storage.delete(this.cacheName);
  }

  async delete(key: string): Promise<void> {
    const cache = await this.storage.open(this.cacheName);
    await cache.delete(cacheRequest(key));
  }

  async get(key: string): Promise<ModelCacheEntry | undefined> {
    const cache = await this.storage.open(this.cacheName);
    const response = await cache.match(cacheRequest(key));
    return response === undefined ? undefined : responseEntry(key, response);
  }

  async list(): Promise<readonly ModelCacheEntry[]> {
    const cache = await this.storage.open(this.cacheName);
    const requests = await cache.keys();
    const entries = await Promise.all(
      requests.map(async (request) => {
        const response = await cache.match(request);
        if (response === undefined) {
          return undefined;
        }
        const key = decodeURIComponent(new URL(request.url).pathname.slice(1));
        return responseEntry(key, response);
      })
    );
    return entries.filter((entry): entry is ModelCacheEntry => entry !== undefined);
  }

  async set(entry: ModelCacheEntry): Promise<void> {
    const cache = await this.storage.open(this.cacheName);
    await cache.put(
      cacheRequest(entry.key),
      new Response(entry.data.slice(0), {
        headers: {
          "content-length": String(entry.bytes),
          "x-ppdoclayout-sha256": entry.sha256
        }
      })
    );
  }
}

function cacheRequest(key: string): Request {
  return new Request(`${CACHE_ORIGIN}${encodeURIComponent(key)}`);
}

async function responseEntry(
  key: string,
  response: Response
): Promise<ModelCacheEntry | undefined> {
  const bytes = Number(response.headers.get("content-length"));
  const sha256 = response.headers.get("x-ppdoclayout-sha256");
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || sha256 === null) {
    return undefined;
  }
  return { bytes, data: await response.arrayBuffer(), key, sha256 };
}
