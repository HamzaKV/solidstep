import { describe, it, expect } from 'vitest';
import { MemoryCacheStore } from '../utils/cache-store';

describe('MemoryCacheStore — basics', () => {
    it('returns null for a miss and the entry for a hit', () => {
        const store = new MemoryCacheStore();
        expect(store.get('nope')).toBeNull();
        store.set('a', 1);
        expect(store.get<number>('a')?.value).toBe(1);
    });

    it('computes wall-clock deadlines from ttl/swr', () => {
        const store = new MemoryCacheStore();
        store.set('none', 1);
        expect(store.get('none')).toMatchObject({
            expiresAt: null,
            staleAt: null,
        });

        store.set('ttl', 1, { ttl: 1000 });
        const ttlEntry = store.get('ttl')!;
        // No swr window: staleAt === expiresAt (plain TTL).
        expect(ttlEntry.staleAt).toBe(ttlEntry.expiresAt);

        store.set('swr', 1, { ttl: 1000, swr: 500 });
        const swrEntry = store.get('swr')!;
        expect(swrEntry.expiresAt! - swrEntry.staleAt!).toBe(500);
    });

    it('treats ttl <= 0 as no expiry', () => {
        const store = new MemoryCacheStore();
        store.set('z', 1, { ttl: 0, swr: 100 });
        expect(store.get('z')).toMatchObject({
            expiresAt: null,
            staleAt: null,
        });
    });

    it('overwrites value and deadlines in place', () => {
        const store = new MemoryCacheStore();
        store.set('k', 'first');
        store.set('k', 'second', { ttl: 1000 });
        const entry = store.get('k')!;
        expect(entry.value).toBe('second');
        expect(entry.expiresAt).toBeTypeOf('number');
    });
});

describe('MemoryCacheStore — LRU list', () => {
    it('moves an accessed tail entry to the front', () => {
        const store = new MemoryCacheStore({ maxEntries: 2 });
        store.set('a', 1); // tail
        store.set('b', 2); // head
        store.get('a'); // a (tail) -> front
        // Insert a third: capacity 2 evicts the current tail (b).
        store.set('c', 3);
        expect(store.get('a')?.value).toBe(1);
        expect(store.get('c')?.value).toBe(3);
        expect(store.get('b')).toBeNull();
    });

    it('moves an accessed middle entry to the front', () => {
        const store = new MemoryCacheStore();
        store.set('a', 1);
        store.set('b', 2);
        store.set('c', 3); // head=c, b middle, a tail
        expect(store.get('b')?.value).toBe(2); // exercises middle unlink
    });

    it('is a no-op when accessing the current head', () => {
        const store = new MemoryCacheStore();
        store.set('a', 1);
        store.set('b', 2); // head=b
        expect(store.get('b')?.value).toBe(2); // head early-return
    });

    it('evicts the least recently used entry past capacity', () => {
        const store = new MemoryCacheStore({ maxEntries: 1000 });
        for (let i = 0; i < 1000; i++) store.set(`lru-${i}`, i);
        store.get('lru-0'); // protect lru-0
        store.set('lru-new', 'new'); // evicts lru-1 (oldest unaccessed)
        expect(store.get('lru-0')?.value).toBe(0);
        expect(store.get('lru-new')?.value).toBe('new');
        expect(store.get('lru-1')).toBeNull();
    });
});

describe('MemoryCacheStore — delete', () => {
    it('is a no-op for a missing key', () => {
        const store = new MemoryCacheStore();
        expect(() => store.delete('ghost')).not.toThrow();
    });

    it('removes the sole entry (head === tail)', () => {
        const store = new MemoryCacheStore();
        store.set('only', 1);
        store.delete('only');
        expect(store.get('only')).toBeNull();
    });

    it('removes a middle entry, relinking neighbors', () => {
        const store = new MemoryCacheStore();
        store.set('a', 1);
        store.set('b', 2);
        store.set('c', 3); // head=c, b middle, a tail
        store.delete('b');
        expect(store.get('b')).toBeNull();
        expect(store.get('a')?.value).toBe(1);
        expect(store.get('c')?.value).toBe(3);
    });

    it('clears all entries', () => {
        const store = new MemoryCacheStore();
        store.set('a', 1);
        store.set('b', 2);
        store.clear();
        expect(store.get('a')).toBeNull();
        expect(store.get('b')).toBeNull();
    });
});

describe('MemoryCacheStore — tags', () => {
    it('invalidates every key sharing a tag, sharing one tag set', () => {
        const store = new MemoryCacheStore();
        store.set('p1', 1, { tags: ['posts'] });
        store.set('p2', 2, { tags: ['posts'] }); // reuses existing tag set
        store.set('u1', 3, { tags: ['users'] });
        store.invalidateTag('posts');
        expect(store.get('p1')).toBeNull();
        expect(store.get('p2')).toBeNull();
        expect(store.get('u1')?.value).toBe(3);
    });

    it('is a no-op for an unknown tag', () => {
        const store = new MemoryCacheStore();
        expect(() => store.invalidateTag('missing')).not.toThrow();
    });

    it('drops stale tag associations when a key is re-tagged', () => {
        const store = new MemoryCacheStore();
        store.set('k', 1, { tags: ['old'] });
        store.set('k', 2, { tags: ['new'] }); // untag 'old'
        store.invalidateTag('old'); // must NOT remove k
        expect(store.get('k')?.value).toBe(2);
        store.invalidateTag('new');
        expect(store.get('k')).toBeNull();
    });

    it('scrubs tags when an entry is evicted by capacity', () => {
        const store = new MemoryCacheStore({ maxEntries: 1 });
        store.set('a', 1, { tags: ['t'] }); // tail
        store.set('b', 2, { tags: ['t'] }); // evicts a, scrubbing a from 't'
        store.invalidateTag('t'); // removes only b
        expect(store.get('a')).toBeNull();
        expect(store.get('b')).toBeNull();
    });

    it('tolerates duplicate tags on a single entry', () => {
        const store = new MemoryCacheStore();
        store.set('k', 1, { tags: ['dup', 'dup'] });
        store.delete('k'); // second 'dup' untag hits the already-removed set
        expect(store.get('k')).toBeNull();
    });
});

describe('MemoryCacheStore — maxBytes', () => {
    const big = (n: number) => 'x'.repeat(n);

    it('evicts the LRU entry when the byte budget is exceeded', () => {
        const store = new MemoryCacheStore({ maxBytes: 60, maxEntries: 100 });
        store.set('a', big(40)); // ~42 bytes, under budget
        store.set('b', big(40)); // ~84 total > 60 → evict LRU 'a'
        expect(store.get('a')).toBeNull();
        expect(store.get<string>('b')?.value).toBe(big(40));
    });

    it('keeps the newest entry even if it alone exceeds maxBytes', () => {
        const store = new MemoryCacheStore({ maxBytes: 10 });
        store.set('big', big(100)); // far over budget, but it's the only entry
        expect(store.get<string>('big')?.value).toBe(big(100));
    });

    it('respects recency: a read protects an entry from eviction', () => {
        const store = new MemoryCacheStore({ maxBytes: 95 });
        store.set('a', big(40)); // ~42
        store.set('b', big(40)); // ~84, both fit
        store.get('a'); // 'a' is now MRU, 'b' is LRU
        store.set('c', big(40)); // ~126 > 95 → evict LRU 'b'
        expect(store.get('b')).toBeNull();
        expect(store.get('a')).not.toBeNull();
        expect(store.get('c')).not.toBeNull();
    });

    it('frees bytes when an existing key is overwritten with a smaller value', () => {
        const store = new MemoryCacheStore({ maxBytes: 95 });
        store.set('a', big(40)); // ~42
        store.set('b', big(40)); // ~84
        store.set('a', 'z'); // shrink 'a' → total ~45
        store.set('c', big(40)); // ~87 ≤ 95 → nothing evicted
        expect(store.get<string>('a')?.value).toBe('z');
        expect(store.get('b')).not.toBeNull();
        expect(store.get('c')).not.toBeNull();
    });

    it('frees bytes on delete', () => {
        const store = new MemoryCacheStore({ maxBytes: 95 });
        store.set('a', big(40)); // ~42
        store.set('b', big(40)); // ~84
        store.delete('a'); // total ~42
        store.set('c', big(40)); // ~84 ≤ 95 → 'b' survives (delete freed bytes)
        expect(store.get('b')).not.toBeNull();
        expect(store.get('c')).not.toBeNull();
    });

    it('treats an unserializable value as size 0 instead of throwing', () => {
        const store = new MemoryCacheStore({ maxBytes: 1000 });
        const bad = {
            get boom(): never {
                throw new Error('cannot serialize');
            },
        };
        expect(() => store.set('bad', bad)).not.toThrow();
        expect(store.get('bad')?.value).toBe(bad);
    });
});
