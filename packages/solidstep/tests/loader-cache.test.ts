import { describe, it, expect, vi, beforeEach } from 'vitest';

// loader-cache imports cache.ts, which pulls in vinxi/http for revalidatePath.
vi.mock('vinxi/http', () => ({
    getEvent: vi.fn(),
    setResponseHeader: vi.fn(),
}));

import { getCachedLoaderData } from '../utils/loader-cache';
import { clearAllCache } from '../utils/cache';

beforeEach(async () => {
    await clearAllCache();
});

const req = (url = 'https://example.com/page?q=1') => new Request(url);

const makeLoader = (data: unknown, cache?: { ttl?: number; key?: string }) => ({
    loader: vi.fn(async () => ({ data })),
    options: cache ? { cache } : {},
});

describe('getCachedLoaderData', () => {
    it('runs the loader every time when caching is not enabled', async () => {
        const loaderFn = makeLoader({ n: 1 });
        expect(await getCachedLoaderData(loaderFn, '/p', req())).toEqual({
            n: 1,
        });
        await getCachedLoaderData(loaderFn, '/p', req());
        expect(loaderFn.loader).toHaveBeenCalledTimes(2);
    });

    it('falls back to {} when the loader returns falsy data', async () => {
        const loaderFn = makeLoader(null);
        expect(await getCachedLoaderData(loaderFn, '/p', req())).toEqual({});
    });

    it('caches a falsy-data loader as {}', async () => {
        const loaderFn = makeLoader(undefined, {});
        expect(await getCachedLoaderData(loaderFn, '/p', req())).toEqual({});
    });

    it('caches by pathname+search and does not re-run within the cache', async () => {
        const loaderFn = makeLoader({ n: 2 }, {});
        const first = await getCachedLoaderData(loaderFn, '/p', req());
        const second = await getCachedLoaderData(loaderFn, '/p', req());
        expect(first).toEqual({ n: 2 });
        expect(second).toEqual({ n: 2 });
        expect(loaderFn.loader).toHaveBeenCalledTimes(1);
    });

    it('keys per-URL by default (different search re-runs)', async () => {
        const loaderFn = makeLoader({ n: 3 }, {});
        await getCachedLoaderData(loaderFn, '/p', req('https://x.com/a?p=1'));
        await getCachedLoaderData(loaderFn, '/p', req('https://x.com/a?p=2'));
        expect(loaderFn.loader).toHaveBeenCalledTimes(2);
    });

    it('shares one cached value across URLs when an explicit key is given', async () => {
        const loaderFn = makeLoader({ n: 4 }, { key: 'shared' });
        await getCachedLoaderData(loaderFn, '/p', req('https://x.com/a'));
        await getCachedLoaderData(loaderFn, '/p', req('https://x.com/b'));
        expect(loaderFn.loader).toHaveBeenCalledTimes(1);
    });

    it('expires the cached value after the ttl', async () => {
        vi.useFakeTimers();
        try {
            const loaderFn = makeLoader({ n: 5 }, { ttl: 1000 });
            await getCachedLoaderData(loaderFn, '/p', req());
            vi.advanceTimersByTime(1500);
            await getCachedLoaderData(loaderFn, '/p', req());
            expect(loaderFn.loader).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('threads locals and the abort signal into the loader', async () => {
        const controller = new AbortController();
        const loader = vi.fn(async () => ({ data: { ok: true } }));
        const loaderFn = { loader, options: {} };
        await getCachedLoaderData(loaderFn, '/p', req(), {
            locals: { user: 'u1' },
            signal: controller.signal,
        });
        expect(loader).toHaveBeenCalledTimes(1);
        const [passedReq, ctx] = loader.mock.calls[0] as [
            Request,
            { locals: Record<string, unknown>; signal?: AbortSignal },
        ];
        // The loader gets a request cloned with the combined signal, plus an
        // explicit context carrying the same signal and the request locals.
        expect(passedReq).toBeInstanceOf(Request);
        expect(ctx.signal).toBe(controller.signal);
        expect(ctx.locals).toEqual({ user: 'u1' });
    });
});
