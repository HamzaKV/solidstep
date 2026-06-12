/**
 * Pure helpers governing the page-render cache. Kept separate from `server.ts`
 * (which pulls in server-only modules) so the policy is unit-testable in
 * isolation.
 */

/** The `cache` block a page may export from its `options`. */
export type PageCacheOptions = {
    ttl?: number;
    swr?: number;
    tags?: string[];
};

/** A page's resolved `options` object (only the fields the cache cares about). */
export type PageRenderOptions = {
    render?: 'static' | 'isr' | 'dynamic' | 'ppr';
    cache?: PageCacheOptions;
};

/**
 * Whether a rendered page should be written to / read from the page-render
 * cache. A page is cached **only** when it opts in with a positive `cache.ttl`.
 *
 * `static`/`isr`/`ppr` pages have their own artifact/ISR caches and are never
 * stored here. This mirrors the loader cache, which skips caching entirely when
 * no `cache` option is present — and matches the documented contract that a
 * `ttl` of `0`/omitted disables page caching (a `ttl<=0` write would otherwise
 * be stored with no expiry, i.e. cached forever).
 */
export const shouldCachePage = (options?: PageRenderOptions): boolean => {
    const render = options?.render;
    if (render === 'static' || render === 'isr' || render === 'ppr') {
        return false;
    }
    return (options?.cache?.ttl ?? 0) > 0;
};

/**
 * The page-render cache key. Includes the query string so distinct queries
 * (`?q=a` vs `?q=b`) don't collide on the same cached render.
 */
export const pageCacheKey = (url: URL): string =>
    `${url.pathname}${url.search}`;
