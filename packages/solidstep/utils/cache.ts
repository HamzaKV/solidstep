import { getEvent, setResponseHeader } from 'vinxi/http';
import {
    MemoryCacheStore,
    type CacheEntry,
    type CacheSetOptions,
    type CacheStore,
} from './cache-store.js';

export type { CacheEntry, CacheSetOptions, CacheStore } from './cache-store.js';
export {
    MemoryCacheStore,
    FilesystemCacheStore,
    type MaybePromise,
} from './cache-store.js';

// The active cache backend. Defaults to an in-memory LRU; swap it at runtime
// (e.g. inside instrumentation `register()`) via `setCacheStore`.
let activeStore: CacheStore = new MemoryCacheStore();

/**
 * Replace the active cache backend. Call once at server startup (typically in
 * the instrumentation `register()` hook) to plug in a filesystem or external
 * (e.g. Redis) store. Overrides any built-in store selected via `defineConfig`.
 *
 * @param store - The {@link CacheStore} implementation to use.
 */
export const setCacheStore = (store: CacheStore): void => {
    activeStore = store;
};

/** Get the active {@link CacheStore} backend. */
export const getCacheStore = (): CacheStore => activeStore;

/**
 * Read a raw cache entry, enforcing **hard expiry**: an entry past its
 * `expiresAt` (wall-clock) is deleted and reported as a miss. A stale-but-not-
 * expired entry (within its SWR window) is returned as-is so callers can serve
 * it while revalidating.
 *
 * @param key - Cache key.
 * @returns The live {@link CacheEntry}, or `null` if missing or hard-expired.
 */
export const getCacheEntry = async <T>(
    key: string,
): Promise<CacheEntry<T> | null> => {
    const entry = await activeStore.get<T>(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
        await activeStore.delete(key);
        return null;
    }
    return entry;
};

/**
 * Read a value from the cache by key.
 *
 * Hard-expired entries are evicted on access and treated as a miss. Within the
 * SWR window the (stale) value is still returned.
 *
 * @param key - Cache key.
 * @returns The cached value, or `null` if missing or expired.
 */
export const getCache = async <T>(key: string): Promise<T | null> => {
    const entry = await getCacheEntry<T>(key);
    return entry ? entry.value : null;
};

/**
 * Like {@link getCache}, but distinguishes a **miss** from a cached value that
 * happens to be `null`/`undefined` — `getCache` returns `null` for both, which
 * defeats negative caching (e.g. caching "this lookup 404'd" for a while).
 *
 * @param key - Cache key.
 * @returns `{ hit: true, value }` on a (non-expired) hit — `value` may be
 *   `null`; `{ hit: false, value: null }` on a miss or hard-expired entry.
 */
export const getCacheResult = async <T>(
    key: string,
): Promise<{ hit: boolean; value: T | null }> => {
    const entry = await getCacheEntry<T>(key);
    return entry
        ? { hit: true, value: entry.value }
        : { hit: false, value: null };
};

/**
 * Store a value in the cache with full {@link CacheSetOptions} (TTL, SWR window,
 * tags). All deadlines are wall-clock (`Date.now()`-based).
 *
 * @param key - Cache key. Reusing a key overwrites its value, deadlines, and tags.
 * @param value - Value to cache.
 * @param options - TTL/SWR/tags.
 */
export const setCacheWithOptions = async <T>(
    key: string,
    value: T,
    options?: CacheSetOptions,
): Promise<void> => {
    await activeStore.set(key, value, options);
};

/**
 * Store a value in the cache.
 *
 * @param key - Cache key. Reusing a key overwrites its value and TTL.
 * @param value - Value to cache.
 * @param ttlMs - Optional time-to-live in milliseconds (wall-clock). Omit for no expiry.
 */
export const setCache = async <T>(
    key: string,
    value: T,
    ttlMs?: number,
): Promise<void> => {
    await activeStore.set(key, value, { ttl: ttlMs });
};

/**
 * Remove a single entry from the cache. No-op if the key is absent.
 *
 * @param key - Cache key to invalidate.
 */
export const invalidateCache = async (key: string): Promise<void> => {
    await activeStore.delete(key);
};

/**
 * Invalidate every cache entry associated with `tag`.
 *
 * @param tag - The tag whose entries should be removed.
 */
export const invalidateTag = async (tag: string): Promise<void> => {
    await activeStore.invalidateTag(tag);
};

/** Empty the entire cache. */
export const clearAllCache = async (): Promise<void> => {
    await activeStore.clear();
};

/**
 * Mark a path for revalidation from within a server action.
 *
 * Sets the `X-Revalidate` response header, which the server action handler
 * uses as a flag to diff and refresh the given path. Only usable inside a
 * server function (the `/_server` endpoint); throws otherwise.
 *
 * @param path - The path to revalidate.
 * @throws If called outside of a server function.
 */
export const revalidatePath = (path: string) => {
    // get and verify the event
    const event = getEvent();
    if (!event.path.includes('_server')) {
        throw new Error('This function can only be used in server functions.');
    }

    // add the revalidate header as a flag for the server action to do diffing
    setResponseHeader(event, 'X-Revalidate', path);
};
