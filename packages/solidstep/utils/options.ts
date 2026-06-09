/**
 * Per-route rendering options.
 */
export type Options = {
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
