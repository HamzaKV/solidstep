import { getCache, setCache } from './cache';

type CacheableLoader = {
    loader: (request?: Request) => Promise<{ data: unknown }>;
    options?: { cache?: { ttl?: number; key?: string } };
};

/**
 * Run a loader, transparently caching its resolved data when the loader opts in
 * via `options.cache`. The cache key is namespaced under `loader:` (so it never
 * collides with the page cache) and defaults to the request `pathname` + search,
 * unless an explicit `cache.key` is given.
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

    const cached = getCache<unknown>(key);
    if (cached !== null) {
        return cached;
    }

    const result = await loaderFn.loader(req);
    const data = result.data || {};
    setCache(key, data, cacheOpts.ttl || 0);
    return data;
};
