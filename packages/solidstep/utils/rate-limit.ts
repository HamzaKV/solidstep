// utils/rate-limit.ts
// A fixed-window rate-limiting middleware backed by the framework's CacheStore,
// so it works with the in-memory default or any external store (e.g. Redis)
// installed via `setCacheStore`. Compose it with `defineMiddleware`.

import { getCacheEntry, setCacheWithOptions } from './cache.js';
import type { Middleware } from './middleware.js';
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

// checkRateLimit's read-modify-write (getCacheEntry then setCacheWithOptions)
// isn't atomic on its own: two concurrent calls for the same key can both
// read the same count and one increment is lost. This in-process, per-key
// lock serializes same-key calls so the read-modify-write can't interleave
// within a single process/instance. A deployment with multiple instances
// sharing an external CacheStore (e.g. Redis) still has a residual race
// across instances unless that store offers an atomic increment — no
// CacheStore currently does, so that's a known limitation, not fixed here.
const keyLocks = new Map<string, Promise<unknown>>();

const withKeyLock = async <T>(
    key: string,
    fn: () => Promise<T>,
): Promise<T> => {
    const prior = keyLocks.get(key) ?? Promise.resolve();
    // Chain onto the prior call for this key regardless of whether it
    // succeeded or failed, so one rejection doesn't wedge later callers.
    const run = prior.then(fn, fn);
    const guarded = run.catch(() => undefined);
    keyLocks.set(key, guarded);
    try {
        return await run;
    } finally {
        // Only the last-in-chain caller for this key clears the entry, so we
        // don't drop a lock a later call is still waiting behind.
        if (keyLocks.get(key) === guarded) {
            keyLocks.delete(key);
        }
    }
};

/**
 * Record one hit against `storeKey` and report whether it exceeds `max` within
 * the current fixed window. Pure of any HTTP plumbing: it reads/writes the
 * active CacheStore, preserving the original window expiry across hits (so the
 * window doesn't slide forward under continuous traffic) and resetting once the
 * entry has expired.
 */
export const checkRateLimit = (
    storeKey: string,
    opts: { windowMs: number; max: number },
): Promise<{ limited: boolean; retryAfterSeconds: number }> =>
    withKeyLock(storeKey, async () => {
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
    });

/**
 * Best-effort client IP from the H3 event, used as the default bucket key.
 *
 * `X-Forwarded-For`'s first hop is attacker-controlled unless a trusted
 * reverse proxy overwrites it before this process sees the request — behind
 * anything else, a client can rotate it to evade its own bucket or spoof a
 * victim's IP into one. Deploy behind a proxy that sets/overwrites this
 * header, or pass a custom `keyFn` deriving the key from a source you trust.
 */
const clientIp = (event: H3Event): string => {
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
