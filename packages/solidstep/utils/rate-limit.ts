// utils/rate-limit.ts
// A fixed-window rate-limiting middleware backed by the framework's CacheStore,
// so it works with the in-memory default or any external store (e.g. Redis)
// installed via `setCacheStore`. Compose it with `defineMiddleware`.

import { getCacheEntry, setCacheWithOptions } from './cache';
import type { Middleware } from './middleware';
import type { H3Event } from 'vinxi/http';

/** Options for {@link rateLimit}. */
export type RateLimitOptions = {
    /** The fixed window length in milliseconds. */
    windowMs: number;
    /** Max requests allowed per key within the window. */
    max: number;
    /**
     * Derive the bucket key from the request event. Defaults to the client IP
     * (`x-forwarded-for` first hop, else the socket address). Override to key by
     * user id, API key, route, etc.
     */
    key?: (event: H3Event) => string;
    /** Body of the `429` response. Defaults to `'Too Many Requests'`. */
    message?: string;
};

/**
 * Record one hit against `storeKey` and report whether it exceeds `max` within
 * the current fixed window. Pure of any HTTP plumbing: it reads/writes the
 * active CacheStore, preserving the original window expiry across hits (so the
 * window doesn't slide forward under continuous traffic) and resetting once the
 * entry has expired.
 */
export const checkRateLimit = async (
    storeKey: string,
    opts: { windowMs: number; max: number },
): Promise<{ limited: boolean; retryAfterSeconds: number }> => {
    const id = `ratelimit:${storeKey}`;
    // getCacheEntry enforces hard expiry, so a window that has elapsed reads as a
    // miss and the counter resets.
    const entry = await getCacheEntry<number>(id);
    const count = (entry?.value ?? 0) + 1;
    const ttl = entry?.expiresAt
        ? Math.max(1, entry.expiresAt - Date.now())
        : opts.windowMs;
    await setCacheWithOptions(id, count, { ttl });
    return {
        limited: count > opts.max,
        retryAfterSeconds: Math.ceil(ttl / 1000),
    };
};

/** Best-effort client IP from the H3 event, used as the default bucket key. */
const clientIp = (event: H3Event): string => {
    // biome-ignore lint/suspicious/noExplicitAny: H3Event's node shape is wider than its published type.
    const req = (event as any).node?.req;
    const xff = req?.headers?.['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length > 0) {
        return xff.split(',')[0].trim();
    }
    return req?.socket?.remoteAddress ?? 'unknown';
};

/**
 * A {@link Middleware} that rejects with `429 Too Many Requests` once a key
 * exceeds `max` requests per `windowMs`, setting a `Retry-After` header.
 *
 * @example
 * ```ts
 * // app/middleware.ts
 * import { defineMiddleware } from 'solidstep/utils/middleware';
 * import { rateLimit } from 'solidstep/utils/rate-limit';
 *
 * export default defineMiddleware([
 *   rateLimit({ windowMs: 60_000, max: 100 }),
 * ]);
 * ```
 */
export const rateLimit = (options: RateLimitOptions): Middleware => {
    const { windowMs, max, key, message = 'Too Many Requests' } = options;
    return {
        onRequest: async (event) => {
            const storeKey = key ? key(event) : clientIp(event);
            const { limited, retryAfterSeconds } = await checkRateLimit(
                storeKey,
                { windowMs, max },
            );
            if (limited) {
                return new Response(message, {
                    status: 429,
                    headers: {
                        'Retry-After': String(retryAfterSeconds),
                        'Content-Type': 'text/plain; charset=utf-8',
                    },
                });
            }
        },
    };
};
