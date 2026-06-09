import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

vi.mock('vinxi/http', () => ({
    getEvent: vi.fn(),
    setResponseHeader: vi.fn(),
}));

import {
    getCache,
    getCacheEntry,
    setCache,
    setCacheWithOptions,
    invalidateCache,
    invalidateTag,
    clearAllCache,
    revalidatePath,
    getCacheStore,
    setCacheStore,
    MemoryCacheStore,
} from '../utils/cache';
import * as vinxiHttp from 'vinxi/http';

beforeEach(async () => {
    await clearAllCache();
});

afterEach(async () => {
    await clearAllCache();
});

describe('setCache / getCache', () => {
    it('stores and retrieves a value without TTL', async () => {
        await setCache('key1', { data: 42 });
        expect(await getCache('key1')).toEqual({ data: 42 });
    });

    it('returns null for a key that was never set', async () => {
        expect(await getCache('missing')).toBeNull();
    });

    it('stores and retrieves with an explicit TTL', async () => {
        await setCache('key2', 'hello', 60_000);
        expect(await getCache('key2')).toBe('hello');
    });

    it('returns null after TTL expires', async () => {
        await setCache('key3', 'short-lived', 1);
        await new Promise((r) => setTimeout(r, 10));
        expect(await getCache('key3')).toBeNull();
    });

    it('returns cached value before TTL expires', async () => {
        await setCache('key4', 'alive', 60_000);
        expect(await getCache('key4')).toBe('alive');
    });

    it('overwrites an existing key', async () => {
        await setCache('k', 'first');
        await setCache('k', 'second');
        expect(await getCache('k')).toBe('second');
    });

    it('updates expiresAt when overwriting an existing key with a TTL', async () => {
        await setCache('k', 'first');
        await setCache('k', 'second', 60_000);
        expect(await getCache('k')).toBe('second');
    });

    it('removes expired head entry that has a next neighbor', async () => {
        await setCache('a', 'a-val'); // tail; head will be b
        await setCache('b', 'b-val', 1); // head, with next=a
        await new Promise((r) => setTimeout(r, 10));
        expect(await getCache('b')).toBeNull();
        expect(await getCache('a')).toBe('a-val');
    });

    it('removes expired tail entry that has a prev neighbor', async () => {
        await setCache('a', 'a-val', 1); // tail, with prev=b
        await setCache('b', 'b-val'); // head
        await new Promise((r) => setTimeout(r, 10));
        expect(await getCache('a')).toBeNull();
        expect(await getCache('b')).toBe('b-val');
    });

    it('handles different value types', async () => {
        await setCache<number>('num', 123);
        await setCache<boolean>('bool', true);
        await setCache<null>('null', null);
        expect(await getCache<number>('num')).toBe(123);
        expect(await getCache<boolean>('bool')).toBe(true);
        expect(await getCache<null>('null')).toBeNull();
    });
});

describe('getCacheEntry', () => {
    it('returns null for a miss', async () => {
        expect(await getCacheEntry('nope')).toBeNull();
    });

    it('exposes deadlines for a stored entry', async () => {
        await setCacheWithOptions('e', 'v', { ttl: 1000, swr: 500 });
        const entry = await getCacheEntry<string>('e');
        expect(entry?.value).toBe('v');
        expect(entry?.staleAt).toBeTypeOf('number');
        expect(entry?.expiresAt).toBeGreaterThan(entry!.staleAt!);
    });

    it('serves a stale-but-not-expired entry within the SWR window', async () => {
        vi.useFakeTimers();
        try {
            await setCacheWithOptions('s', 'v', { ttl: 1000, swr: 5000 });
            vi.advanceTimersByTime(2000); // past staleAt, before expiresAt
            const entry = await getCacheEntry<string>('s');
            expect(entry?.value).toBe('v');
            expect(entry!.staleAt!).toBeLessThan(Date.now());
        } finally {
            vi.useRealTimers();
        }
    });

    it('evicts and reports a miss once hard-expired', async () => {
        vi.useFakeTimers();
        try {
            await setCacheWithOptions('h', 'v', { ttl: 1000, swr: 500 });
            vi.advanceTimersByTime(2000); // past expiresAt
            expect(await getCacheEntry('h')).toBeNull();
            expect(await getCache('h')).toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('invalidateCache', () => {
    it('removes a specific key', async () => {
        await setCache('a', 1);
        await setCache('b', 2);
        await invalidateCache('a');
        expect(await getCache('a')).toBeNull();
        expect(await getCache('b')).toBe(2);
    });

    it('invalidates the head entry (has next, no prev)', async () => {
        await setCache('a', 1); // tail
        await setCache('b', 2); // head, next=a
        await invalidateCache('b');
        expect(await getCache('b')).toBeNull();
        expect(await getCache('a')).toBe(1);
    });

    it('is a no-op for a missing key', async () => {
        await expect(invalidateCache('not-here')).resolves.toBeUndefined();
    });
});

describe('invalidateTag', () => {
    it('removes every entry sharing a tag, leaving others', async () => {
        await setCacheWithOptions('p1', 1, { tags: ['posts'] });
        await setCacheWithOptions('p2', 2, { tags: ['posts', 'home'] });
        await setCacheWithOptions('u1', 3, { tags: ['users'] });
        await invalidateTag('posts');
        expect(await getCache('p1')).toBeNull();
        expect(await getCache('p2')).toBeNull();
        expect(await getCache('u1')).toBe(3);
    });
});

describe('clearAllCache', () => {
    it('removes all entries', async () => {
        await setCache('x', 1);
        await setCache('y', 2);
        await clearAllCache();
        expect(await getCache('x')).toBeNull();
        expect(await getCache('y')).toBeNull();
    });
});

describe('store registry', () => {
    afterEach(() => {
        // Restore the default store so other suites are unaffected.
        setCacheStore(new MemoryCacheStore());
    });

    it('routes reads/writes through the active store', async () => {
        const custom = new MemoryCacheStore({ maxEntries: 2 });
        setCacheStore(custom);
        expect(getCacheStore()).toBe(custom);
        await setCache('via-store', 'v');
        expect(await getCache('via-store')).toBe('v');
        expect(await custom.get('via-store')).not.toBeNull();
    });
});

describe('revalidatePath', () => {
    beforeEach(() => {
        vi.mocked(vinxiHttp.getEvent).mockReset();
        vi.mocked(vinxiHttp.setResponseHeader).mockReset();
    });

    it('sets X-Revalidate header when called from a server function', () => {
        const fakeEvent = { path: '/api/_server/action' };
        vi.mocked(vinxiHttp.getEvent).mockReturnValue(fakeEvent as any);

        revalidatePath('/dashboard');

        expect(vinxiHttp.setResponseHeader).toHaveBeenCalledWith(
            fakeEvent,
            'X-Revalidate',
            '/dashboard',
        );
    });

    it('throws when called outside a server function context', () => {
        const fakeEvent = { path: '/api/data' };
        vi.mocked(vinxiHttp.getEvent).mockReturnValue(fakeEvent as any);

        expect(() => revalidatePath('/dashboard')).toThrow(
            'This function can only be used in server functions.',
        );
    });
});
