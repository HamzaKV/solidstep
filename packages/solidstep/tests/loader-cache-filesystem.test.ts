import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// loader-cache → cache.ts → vinxi/http (for revalidatePath); mock it.
vi.mock('vinxi/http', () => ({
    getEvent: vi.fn(),
    setResponseHeader: vi.fn(),
}));

import { getCachedLoaderData } from '../utils/loader-cache';
import { setCacheStore } from '../utils/cache';
import { MemoryCacheStore, FilesystemCacheStore } from '../utils/cache-store';

// Proves loader data caching is persistent/shared when the active CacheStore is
// a filesystem (or external) store — the same wiring as the page cache.
let dir: string;

const req = (url = 'https://example.com/stats?range=7d') => new Request(url);
const makeLoader = (data: unknown) => ({
    loader: vi.fn(async () => ({ data })),
    options: { cache: { ttl: 60_000 } },
});

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'solidstep-loadercache-'));
    setCacheStore(new FilesystemCacheStore({ dir }));
});

afterEach(() => {
    // Restore the default store so other tests are unaffected (it's module-global).
    setCacheStore(new MemoryCacheStore());
    rmSync(dir, { recursive: true, force: true });
});

describe('loader caching on a FilesystemCacheStore', () => {
    it('serves a cache hit from disk (loader runs once)', async () => {
        const loaderFn = makeLoader({ visits: 42 });
        const first = await getCachedLoaderData(loaderFn, '/stats', req());
        const second = await getCachedLoaderData(loaderFn, '/stats', req());
        expect(first).toEqual({ visits: 42 });
        expect(second).toEqual({ visits: 42 });
        expect(loaderFn.loader).toHaveBeenCalledTimes(1);
    });

    it('persists across store instances (a fresh process still hits the cache)', async () => {
        const writer = makeLoader({ visits: 7 });
        await getCachedLoaderData(writer, '/stats', req());
        expect(writer.loader).toHaveBeenCalledTimes(1);

        // Simulate a process restart: a brand-new store over the same dir, and a
        // brand-new loader fn. The data must come from disk, not be recomputed.
        setCacheStore(new FilesystemCacheStore({ dir }));
        const fresh = makeLoader({ visits: 999 }); // different data — must NOT run
        const value = await getCachedLoaderData(fresh, '/stats', req());
        expect(value).toEqual({ visits: 7 });
        expect(fresh.loader).not.toHaveBeenCalled();
    });

    it('reconstructs non-JSON loader values (Date) from disk', async () => {
        const loaderFn = makeLoader({ at: new Date(0) });
        await getCachedLoaderData(loaderFn, '/stats', req());
        setCacheStore(new FilesystemCacheStore({ dir }));
        const value = (await getCachedLoaderData(
            makeLoader({ at: new Date(1) }),
            '/stats',
            req(),
        )) as { at: Date };
        expect(value.at).toBeInstanceOf(Date);
        expect(value.at.getTime()).toBe(0);
    });
});
