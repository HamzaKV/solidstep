import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

vi.mock('vinxi/http', () => ({
    getEvent: vi.fn(),
    setResponseHeader: vi.fn(),
}));

import {
    getCache,
    setCache,
    invalidateCache,
    clearAllCache,
    revalidatePath,
} from '../utils/cache';
import * as vinxiHttp from 'vinxi/http';

beforeEach(() => {
    clearAllCache();
});

afterEach(() => {
    clearAllCache();
});

describe('setCache / getCache', () => {
    it('stores and retrieves a value without TTL', () => {
        setCache('key1', { data: 42 });
        expect(getCache('key1')).toEqual({ data: 42 });
    });

    it('returns null for a key that was never set', () => {
        expect(getCache('missing')).toBeNull();
    });

    it('stores and retrieves with an explicit TTL', () => {
        setCache('key2', 'hello', 60_000);
        expect(getCache('key2')).toBe('hello');
    });

    it('returns null after TTL expires', async () => {
        setCache('key3', 'short-lived', 1);
        await new Promise((r) => setTimeout(r, 10));
        expect(getCache('key3')).toBeNull();
    });

    it('returns cached value before TTL expires', () => {
        setCache('key4', 'alive', 60_000);
        expect(getCache('key4')).toBe('alive');
    });

    it('overwrites an existing key', () => {
        setCache('k', 'first');
        setCache('k', 'second');
        expect(getCache('k')).toBe('second');
    });

    it('updates expiresAt when overwriting an existing key with a TTL', () => {
        setCache('k', 'first');
        setCache('k', 'second', 60_000);
        expect(getCache('k')).toBe('second');
    });

    it('removes expired head entry that has a next neighbor', async () => {
        setCache('a', 'a-val'); // tail; head will be b
        setCache('b', 'b-val', 1); // head, with next=a
        await new Promise((r) => setTimeout(r, 10));
        expect(getCache('b')).toBeNull();
        expect(getCache('a')).toBe('a-val');
    });

    it('removes expired tail entry that has a prev neighbor', async () => {
        setCache('a', 'a-val', 1); // tail, with prev=b
        setCache('b', 'b-val'); // head
        await new Promise((r) => setTimeout(r, 10));
        expect(getCache('a')).toBeNull();
        expect(getCache('b')).toBe('b-val');
    });

    it('handles different value types', () => {
        setCache<number>('num', 123);
        setCache<boolean>('bool', true);
        setCache<null>('null', null);
        expect(getCache<number>('num')).toBe(123);
        expect(getCache<boolean>('bool')).toBe(true);
        expect(getCache<null>('null')).toBeNull();
    });
});

describe('LRU eviction', () => {
    it('evicts the least recently used entry when capacity is exceeded', () => {
        for (let i = 0; i < 1000; i++) {
            setCache(`lru-${i}`, i);
        }
        // Access lru-0 to move it to the front
        getCache('lru-0');
        // Insert one more to trigger eviction (tail should be lru-1 now)
        setCache('lru-new', 'new');
        expect(getCache('lru-0')).toBe(0);
        expect(getCache('lru-new')).toBe('new');
        // lru-1 should have been evicted (it was the oldest unaccessed)
        expect(getCache('lru-1')).toBeNull();
    });
});

describe('invalidateCache', () => {
    it('removes a specific key', () => {
        setCache('a', 1);
        setCache('b', 2);
        invalidateCache('a');
        expect(getCache('a')).toBeNull();
        expect(getCache('b')).toBe(2);
    });

    it('invalidates the head entry (has next, no prev)', () => {
        setCache('a', 1); // tail
        setCache('b', 2); // head, next=a
        invalidateCache('b');
        expect(getCache('b')).toBeNull();
        expect(getCache('a')).toBe(1);
    });

    it('is a no-op for a missing key', () => {
        expect(() => invalidateCache('not-here')).not.toThrow();
    });
});

describe('clearAllCache', () => {
    it('removes all entries', () => {
        setCache('x', 1);
        setCache('y', 2);
        clearAllCache();
        expect(getCache('x')).toBeNull();
        expect(getCache('y')).toBeNull();
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
