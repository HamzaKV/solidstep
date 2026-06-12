/**
 * Per-route rendering options.
 */
export type Options = {
    /**
     * Rendering strategy for the route.
     *
     * - `'dynamic'` (default) — server-render on every request (SSR).
     * - `'static'` — prerender to an HTML artifact at build time (SSG); served
     *   directly by the static layer with no per-request rendering.
     * - `'isr'` — prerender at build time, then incrementally regenerate in the
     *   background after `revalidate` seconds (artifact + stale-while-revalidate).
     * - `'ppr'` — partial prerendering: prerender a static shell (with each
     *   deferred loader's `loading.tsx` fallback baked in) at build time; the
     *   dynamic "holes" are filled on the client per request by fetching their
     *   loader data. Mark holes with deferred loaders (`type: 'defer'`).
     *
     * Dynamic routes (`[id]`, `[...slug]`) using `'static'`/`'isr'`/`'ppr'` must
     * export `generateStaticParams` to enumerate the paths to prerender.
     */
    render?: 'static' | 'isr' | 'dynamic' | 'ppr';
    /**
     * ISR revalidation interval in **seconds**. After this long the cached
     * render is served stale while it regenerates in the background. Only used
     * when `render: 'isr'` (defaults to 60s if omitted).
     */
    revalidate?: number;
    /** Server-side render cache settings. */
    cache?: {
        /** Time-to-live for the cached render, in milliseconds. */
        ttl?: number;
        /**
         * Stale-while-revalidate window in milliseconds, applied after `ttl`.
         * Within it the cached render is still served (stale).
         */
        swr?: number;
        /** Tags for group invalidation of the cached render via `invalidateTag`. */
        tags?: string[];
    };
    /** Extra headers to set on the route's response. */
    responseHeaders?: {
        [key: string]: string;
    };
    /** Client hydration behavior for the route. */
    hydration?: {
        /** Disable client hydration entirely (render as static HTML). */
        disable?: boolean;
        /** Block rendering until hydration is ready. */
        blockRender?: boolean;
        /** Fetch priority hint for the hydration script. */
        fetchPriority?: 'high' | 'low' | 'auto';
    };
};

/**
 * Identity helper for defining a route's {@link Options} with type inference.
 * Export its result as `options` from a route module.
 *
 * @param options - The route options.
 * @returns The same options object, typed as `Options`.
 */
export const options = (options: Options) => options;
