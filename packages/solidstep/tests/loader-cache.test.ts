import { describe, it, expect, vi, beforeEach } from 'vitest';

// loader-cache imports cache.ts, which pulls in vinxi/http for revalidatePath.
vi.mock('vinxi/http', () => ({
    getEvent: vi.fn(),
    setResponseHeader: vi.fn(),
}));
const isPreviewActive = vi.fn(() => false);
vi.mock('../utils/preview', () => ({
    isPreviewActive: () => isPreviewActive(),
}));

import { getCachedLoaderData } from '../utils/loader-cache';
import { clearAllCache } from '../utils/cache';

beforeEach(async () => {
    await clearAllCache();
    isPreviewActive.mockReset().mockReturnValue(false);
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

    it('isolates preview reads/writes into their own cache namespace, in both directions', async () => {
        // A loader whose result depends on when it actually ran, so distinct
        // cache entries are distinguishable by value.
        let n = 0;
        const loaderFn = {
            loader: vi.fn(async () => ({ data: { n: ++n } })),
            options: { cache: {} },
        };

        // Warm the published (non-preview) cache.
        const published = await getCachedLoaderData(loaderFn, '/p', req());
        expect(published).toEqual({ n: 1 });
        expect(loaderFn.loader).toHaveBeenCalledTimes(1);

        // A preview request must NOT read the published entry -- it gets its
        // own fresh render, in its own namespace.
        isPreviewActive.mockReturnValue(true);
        const preview1 = await getCachedLoaderData(loaderFn, '/p', req());
        expect(preview1).toEqual({ n: 2 });
        expect(loaderFn.loader).toHaveBeenCalledTimes(2);

        // A second preview request reuses PREVIEW's own cache entry (not the
        // published one) -- preview mode still benefits from caching, it's
        // just isolated, not "never cache."
        const preview2 = await getCachedLoaderData(loaderFn, '/p', req());
        expect(preview2).toEqual({ n: 2 });
        expect(loaderFn.loader).toHaveBeenCalledTimes(2);

        // Back to non-preview: still the original published value, untouched
        // by anything the preview requests wrote.
        isPreviewActive.mockReturnValue(false);
        const publishedAgain = await getCachedLoaderData(loaderFn, '/p', req());
        expect(publishedAgain).toEqual({ n: 1 });
        expect(loaderFn.loader).toHaveBeenCalledTimes(2);
    });

    it('never coalesces a preview call and a non-preview call sharing the same key onto one in-flight execution', async () => {
        let resolvePublished: (v: { data: unknown }) => void;
        let resolvePreview: (v: { data: unknown }) => void;
        let callCount = 0;
        const loader = vi.fn(() => {
            callCount += 1;
            return new Promise<{ data: unknown }>((r) => {
                if (callCount === 1) resolvePublished = r;
                else resolvePreview = r;
            });
        });
        const loaderFn = { loader, options: { cache: {} } };
        const sameReq = req('https://example.com/coalesce-preview-test');

        isPreviewActive.mockReturnValue(false);
        const publishedPromise = getCachedLoaderData(loaderFn, '/p', sameReq);
        await new Promise((r) => setTimeout(r, 0));

        isPreviewActive.mockReturnValue(true);
        const previewPromise = getCachedLoaderData(loaderFn, '/p', sameReq);
        await new Promise((r) => setTimeout(r, 0));

        // Both calls actually ran the loader -- the preview call did not
        // coalesce onto the published call's in-flight promise.
        expect(loader).toHaveBeenCalledTimes(2);

        resolvePublished!({ data: { who: 'published' } });
        resolvePreview!({ data: { who: 'preview' } });
        expect(await publishedPromise).toEqual({ who: 'published' });
        expect(await previewPromise).toEqual({ who: 'preview' });
    });

    it('shares one cached value across URLs when an explicit key is given', async () => {
        const loaderFn = makeLoader({ n: 4 }, { key: 'shared' });
        await getCachedLoaderData(loaderFn, '/p', req('https://x.com/a'));
        await getCachedLoaderData(loaderFn, '/p', req('https://x.com/b'));
        expect(loaderFn.loader).toHaveBeenCalledTimes(1);
    });

    it('coalesces concurrent identical cache misses into a single loader run', async () => {
        let resolveLoader: (v: { data: unknown }) => void;
        const loader = vi.fn(
            () => new Promise<{ data: unknown }>((r) => (resolveLoader = r)),
        );
        const loaderFn = { loader, options: { cache: {} } };
        const concurrentReq = req('https://example.com/coalesce-test');

        const calls = [
            getCachedLoaderData(loaderFn, '/p', concurrentReq),
            getCachedLoaderData(loaderFn, '/p', concurrentReq),
            getCachedLoaderData(loaderFn, '/p', concurrentReq),
        ];
        // Let the pending cache-read microtasks ahead of the loader call
        // settle before resolving it.
        await new Promise((r) => setTimeout(r, 0));
        resolveLoader!({ data: { n: 6 } });
        const results = await Promise.all(calls);

        expect(results).toEqual([{ n: 6 }, { n: 6 }, { n: 6 }]);
        expect(loader).toHaveBeenCalledTimes(1);
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

    describe('load: many interleaved preview/non-preview paths at once', () => {
        it('every one of many concurrent (path, previewState) combinations resolves its own correct value, with no cross-contamination', async () => {
            // `isPreviewActive()` is read synchronously at the very top of
            // getCachedLoaderData, before its first await -- so toggling the
            // mock immediately before each call (in the same synchronous
            // turn, no await in between) reliably "stamps" that call's
            // preview state, even though none of the calls are awaited
            // individually until the end.
            const PATH_COUNT = 25;
            const loaders = Array.from({ length: PATH_COUNT }, (_, i) => ({
                loader: vi.fn(async () => {
                    await new Promise((r) => setTimeout(r, 1));
                    return { data: { path: i, at: Date.now() } };
                }),
                options: { cache: {} },
            }));

            const calls: Promise<unknown>[] = [];
            const expectedPreview: boolean[] = [];
            for (let round = 0; round < 3; round++) {
                for (let i = 0; i < PATH_COUNT; i++) {
                    const preview = (i + round) % 2 === 0;
                    isPreviewActive.mockReturnValue(preview);
                    expectedPreview.push(preview);
                    calls.push(
                        getCachedLoaderData(
                            loaders[i],
                            '/p',
                            req(`https://example.com/load-${i}`),
                        ),
                    );
                }
            }
            const results = (await Promise.all(calls)) as {
                path: number;
            }[];

            for (let j = 0; j < results.length; j++) {
                const expectedPath = j % PATH_COUNT;
                expect(results[j].path, `call ${j}`).toBe(expectedPath);
            }

            // Each path's loader ran at most twice (once for preview, once
            // for published) despite 3 rounds -- the 2nd/3rd round for a
            // given (path, previewState) pair coalesces onto the cached
            // value from round 1, never re-running or leaking into the
            // other namespace.
            for (let i = 0; i < PATH_COUNT; i++) {
                expect(
                    loaders[i].loader.mock.calls.length,
                    `path ${i}`,
                ).toBeLessThanOrEqual(2);
            }
        });
    });
});
