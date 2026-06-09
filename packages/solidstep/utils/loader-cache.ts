import { getCacheEntry, setCacheWithOptions } from './cache';
import { singleFlight } from './single-flight';

type CacheableLoader = {
    loader: (request?: Request) => Promise<{ data: unknown }>;
    options?: {
        cache?: { ttl?: number; key?: string; swr?: number; tags?: string[] };
    };
};

/**
 * Run a loader, transparently caching its resolved data when the loader opts in
 * via `options.cache`. The cache key is namespaced under `loader:` (so it never
 * collides with the page cache) and defaults to the request `pathname` + search,
 * unless an explicit `cache.key` is given.
 *
 * Hardening behaviors when caching is enabled:
 * - **Single-flight coalescing**: concurrent identical loads share one
 *   execution of the loader instead of each running it.
 * - **Stale-while-revalidate**: within the `cache.swr` window after `ttl`, the
 *   stale value is returned immediately while one background revalidation runs.
 * - **Tags**: entries are written with `cache.tags` for group invalidation via
 *   `invalidateTag`.
 *
 * @param loaderFn - The `{ loader, options }` wrapper produced by `defineLoader`.
 * @param manifestPath - The loader's manifest path (part of the cache key).
 * @param req - The incoming request (its URL forms the default key).
 * @returns The loader's resolved `data` (cached when enabled).
 */
export const getCachedLoaderData = async (
    loaderFn: CacheableLoader,
    manifestPath: string,
    req: Request,
): Promise<unknown> => {
    const cacheOpts = loaderFn.options?.cache;
    if (!cacheOpts) {
        const result = await loaderFn.loader(req);
        return result.data || {};
    }

    const url = new URL(req.url);
    const keySuffix = cacheOpts.key ?? `${url.pathname}${url.search}`;
    const key = `loader:${manifestPath}:${keySuffix}`;

    const run = async () => {
        const result = await loaderFn.loader(req);
        const data = result.data || {};
        await setCacheWithOptions(key, data, {
            ttl: cacheOpts.ttl || 0,
            swr: cacheOpts.swr,
            tags: cacheOpts.tags,
        });
        return data;
    };

    const entry = await getCacheEntry<unknown>(key);
    if (entry) {
        // Fresh (no stale window, or still within it): serve directly.
        if (entry.staleAt === null || Date.now() < entry.staleAt) {
            return entry.value;
        }
        // Stale-but-not-expired: serve stale now, revalidate in the background
        // (coalesced so only one revalidation runs).
        singleFlight(key, run).catch(() => undefined);
        return entry.value;
    }

    // Miss or hard-expired: coalesce concurrent loads into one run.
    return singleFlight(key, run);
};
