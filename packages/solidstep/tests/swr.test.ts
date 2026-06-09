import { describe, it, expect, vi, beforeEach } from 'vitest';

// loader-cache -> cache -> vinxi/http (for revalidatePath); stub it.
vi.mock('vinxi/http', () => ({
    getEvent: vi.fn(),
    setResponseHeader: vi.fn(),
}));

import { getCachedLoaderData } from '../utils/loader-cache';
import { clearAllCache, invalidateTag } from '../utils/cache';

const req = (url = 'https://example.com/page') => new Request(url);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A loader whose data is an incrementing counter, with the given cache opts. */
const counterLoader = (cache: {
    ttl?: number;
    key?: string;
    swr?: number;
    tags?: string[];
}) => {
    let n = 0;
    return {
        loader: vi.fn(async () => ({ data: ++n })),
        options: { cache },
    };
};

beforeEach(async () => {
    await clearAllCache();
});

describe('loader cache — SWR', () => {
    it('serves a fresh value from cache without re-running', async () => {
        const lf = counterLoader({ ttl: 60_000 });
        expect(await getCachedLoaderData(lf, '/p', req())).toBe(1);
        expect(await getCachedLoaderData(lf, '/p', req())).toBe(1);
        expect(lf.loader).toHaveBeenCalledTimes(1);
    });

    it('serves stale within the SWR window and revalidates in the background', async () => {
        const lf = counterLoader({ ttl: 10, swr: 60_000 });
        expect(await getCachedLoaderData(lf, '/p', req())).toBe(1);

        await sleep(25); // past staleAt (10ms), well before expiresAt
        const stale = await getCachedLoaderData(lf, '/p', req());
        expect(stale).toBe(1); // stale value served immediately
        expect(lf.loader).toHaveBeenCalledTimes(2); // one background revalidation

        await sleep(20); // let the background write settle
        // The revalidated value (2) is now what the cache holds.
        expect(await getCachedLoaderData(lf, '/p', req())).toBe(2);
    });

    it('keeps serving stale when the background revalidation fails', async () => {
        let n = 0;
        const lf = {
            loader: vi.fn(async () => {
                n += 1;
                if (n > 1) throw new Error('revalidation failed');
                return { data: n };
            }),
            options: { cache: { ttl: 10, swr: 60_000 } },
        };
        expect(await getCachedLoaderData(lf, '/p', req())).toBe(1);

        await sleep(25); // go stale
        // Stale read returns the old value; the background revalidation rejects
        // (swallowed) and the cached value is left intact.
        expect(await getCachedLoaderData(lf, '/p', req())).toBe(1);
        await sleep(20); // let the failed revalidation settle
        expect(await getCachedLoaderData(lf, '/p', req())).toBe(1);
    });

    it('hard-expired entry (no SWR) blocks on a fresh run', async () => {
        const lf = counterLoader({ ttl: 10 });
        expect(await getCachedLoaderData(lf, '/p', req())).toBe(1);
        await sleep(25); // past expiresAt
        expect(await getCachedLoaderData(lf, '/p', req())).toBe(2);
        expect(lf.loader).toHaveBeenCalledTimes(2);
    });
});

describe('loader cache — single-flight coalescing', () => {
    it('runs the loader once for concurrent identical misses', async () => {
        let n = 0;
        const lf = {
            loader: vi.fn(
                () =>
                    new Promise<{ data: number }>((res) =>
                        setTimeout(() => res({ data: ++n }), 20),
                    ),
            ),
            options: { cache: { ttl: 60_000 } },
        };
        const [a, b] = await Promise.all([
            getCachedLoaderData(lf, '/p', req()),
            getCachedLoaderData(lf, '/p', req()),
        ]);
        expect(a).toBe(1);
        expect(b).toBe(1);
        expect(lf.loader).toHaveBeenCalledTimes(1);
    });
});

describe('loader cache — tags', () => {
    it('re-runs after its tag is invalidated', async () => {
        const lf = counterLoader({ ttl: 60_000, tags: ['posts'] });
        expect(await getCachedLoaderData(lf, '/p', req())).toBe(1);
        await invalidateTag('posts');
        expect(await getCachedLoaderData(lf, '/p', req())).toBe(2);
        expect(lf.loader).toHaveBeenCalledTimes(2);
    });
});
