import { getCacheEntry, setCacheWithOptions } from './cache.js';
import { singleFlight } from './single-flight.js';
import {
    resolveLoaderTimeout,
    runWithLoaderTimeout,
} from './loader-timeout.js';
import type { LoaderContext } from './loader.js';
import { isPreviewActive } from './preview.js';

type CacheableLoader = {
    loader: (
        request?: Request,
        context?: LoaderContext,
    ) => Promise<{ data: unknown }>;
    options?: {
        timeout?: number;
        cache?: { ttl?: number; key?: string; swr?: number; tags?: string[] };
    };
};

/**
 * Request-scoped values threaded from the handler into a loader invocation:
 * the middleware-populated `locals` and the request's abort `signal` (client
 * disconnect). Combined with the loader's timeout inside {@link invokeLoader}.
 */
export type LoaderInvocation = {
    locals?: Record<string, unknown>;
    signal?: AbortSignal;
};

/**
 * Invoke a loader under its effective timeout + the request's abort signal,
 * passing the request (cloned with the combined signal so the loader can forward
 * it) and a {@link LoaderContext}. This is the single funnel every loader call
 * (sequential, deferred, hole, soft-nav) routes through.
 */
const invokeLoader = (
    loaderFn: CacheableLoader,
    req: Request,
    invocation?: LoaderInvocation,
): Promise<{ data: unknown }> => {
    const timeoutMs = resolveLoaderTimeout(loaderFn.options?.timeout);
    return runWithLoaderTimeout(
        (signal) => {
            const request = signal ? new Request(req, { signal }) : req;
            const context: LoaderContext = {
                locals: (invocation?.locals ?? {}) as LoaderContext['locals'],
                signal,
            };
            return loaderFn.loader(request, context);
        },
        { timeoutMs, parentSignal: invocation?.signal },
    );
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
 * @param invocation - Request-scoped `locals` + abort `signal` to thread in.
 * @returns The loader's resolved `data` (cached when enabled).
 */
export const getCachedLoaderData = async (
    loaderFn: CacheableLoader,
    manifestPath: string,
    req: Request,
    invocation?: LoaderInvocation,
): Promise<unknown> => {
    const cacheOpts = loaderFn.options?.cache;
    if (!cacheOpts) {
        const result = await invokeLoader(loaderFn, req, invocation);
        return result.data || {};
    }

    const url = new URL(req.url);
    const keySuffix = cacheOpts.key ?? `${url.pathname}${url.search}`;
    const baseKey = `loader:${manifestPath}:${keySuffix}`;
    // Preview mode reads and writes an entirely separate cache namespace (and
    // therefore a separate singleFlight key below), so a preview render can
    // never see published data, never coalesce onto a published request's
    // in-flight execution (or vice versa), and never pollutes the published
    // cache with draft content. Preview still benefits from caching -- it's
    // isolated, not disabled.
    const key = isPreviewActive() ? `preview:${baseKey}` : baseKey;

    const run = async () => {
        const result = await invokeLoader(loaderFn, req, invocation);
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
