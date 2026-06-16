import { isServer } from 'solid-js/web';

/**
 * Request-scoped values populated by middleware (via `event.locals`) and threaded
 * through to loaders and route components. Augment it with module declaration
 * merging to type your own keys:
 *
 * ```ts
 * declare module 'solidstep/utils/loader' {
 *   interface Locals {
 *     user?: { id: string };
 *   }
 * }
 * ```
 */
export interface Locals {
    /** The per-request CSP nonce, when a nonce policy is in use. */
    cspNonce?: string;
}

/**
 * The second argument passed to a loader: the request-scoped {@link Locals} plus
 * the combined abort `signal` (client disconnect **and** the loader timeout).
 * Forward `signal` to `fetch`/DB calls so they cancel when the request aborts or
 * the loader times out.
 */
export type LoaderContext = {
    locals: Locals;
    signal?: AbortSignal;
};

type LoaderFunction<T> = (
    request?: Request,
    context?: LoaderContext,
) => Promise<T>;

type LoaderOptions = {
    /**
     * Execution strategy relative to sibling loaders. `'sequential'` (default)
     * blocks the initial render; `'defer'` streams the data in after the shell.
     */
    type?: 'defer' | 'sequential';
    /**
     * Abort the loader if it runs longer than this many milliseconds, rejecting
     * with a `LoaderTimeoutError` (which flows through the usual error isolation:
     * a page loader renders `error.tsx`, a layout/group loader yields the error
     * sentinel). Overrides the global `loaderTimeout` from `defineConfig`. Omit
     * to inherit the global default; set `0` to explicitly disable it.
     */
    timeout?: number;
    /**
     * Cache the loader's resolved data on the server.
     *
     * - `ttl` — lifetime in milliseconds (`0`/omitted = no expiry).
     * - `key` — override the cache key. Defaults to the request `pathname` +
     *   search, so the same loader caches per-URL. Provide a stable string to
     *   share one cached value across URLs.
     * - `swr` — stale-while-revalidate window in milliseconds applied after
     *   `ttl`. Within it the stale value is served immediately while one
     *   background revalidation refreshes the cache.
     * - `tags` — tags for group invalidation via `invalidateTag`.
     */
    cache?: {
        ttl?: number;
        key?: string;
        swr?: number;
        tags?: string[];
    };
};

/**
 * Define a server-side data loader for a route.
 *
 * Runs only on the server: on the client `defineLoader` returns `null`, so the
 * loader body and its dependencies never reach the browser bundle. On the
 * server it wraps the loader's result as `{ data, type }`, where `type`
 * controls execution strategy relative to sibling loaders (`'sequential'` by
 * default, or `'defer'`).
 *
 * @param loader - Async function receiving the `Request` and returning data.
 * @param options - Loader options (e.g. `type: 'defer' | 'sequential'`).
 * @returns `{ loader, options }` on the server, or `null` on the client.
 *
 * @example
 * ```ts
 * export const loader = defineLoader(async (req) => {
 *   return getUser(req);
 * });
 * ```
 */
export const defineLoader = <T>(
    loader: LoaderFunction<T>,
    options?: LoaderOptions,
) => {
    if (isServer) {
        const fn = async (request?: Request, context?: LoaderContext) => {
            const loaderData = await loader(request, context);
            return {
                data: loaderData,
                type: options?.type || 'sequential',
            };
        };

        return {
            loader: fn,
            options: options || {},
        };
    }

    return null; // Return null if not on the server
};

/**
 * Extract the resolved data type produced by a {@link defineLoader} result.
 *
 * Unwraps the `{ data }` payload, giving components a precise type for the
 * value a loader provides. Resolves to `never` if `T` is not a loader.
 *
 * @typeParam T - The value returned by `defineLoader`.
 */
export type LoaderDataFromFunction<T> = T extends {
    loader: infer L extends (...args: any) => any;
}
    ? Awaited<ReturnType<T['loader']>> extends { data: infer D }
        ? D
        : never
    : never;
