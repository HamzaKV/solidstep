import { describe, it, expect } from 'vitest';
import { shouldCachePage, pageCacheKey } from '../utils/page-cache';

describe('shouldCachePage', () => {
    it('does not cache a plain dynamic page with no cache options', () => {
        expect(shouldCachePage(undefined)).toBe(false);
        expect(shouldCachePage({})).toBe(false);
        expect(shouldCachePage({ render: 'dynamic' })).toBe(false);
    });

    it('does not cache when ttl is 0 or negative (the documented "disabled" contract)', () => {
        expect(shouldCachePage({ cache: { ttl: 0 } })).toBe(false);
        expect(shouldCachePage({ cache: { ttl: -5 } })).toBe(false);
    });

    it('caches only when an explicit positive ttl is set', () => {
        expect(shouldCachePage({ cache: { ttl: 1 } })).toBe(true);
        expect(shouldCachePage({ cache: { ttl: 60_000, swr: 1000 } })).toBe(
            true,
        );
    });

    it('never caches static/isr/ppr renders (they have their own artifact caches)', () => {
        expect(
            shouldCachePage({ render: 'static', cache: { ttl: 60_000 } }),
        ).toBe(false);
        expect(shouldCachePage({ render: 'isr', cache: { ttl: 60_000 } })).toBe(
            false,
        );
        expect(shouldCachePage({ render: 'ppr', cache: { ttl: 60_000 } })).toBe(
            false,
        );
    });
});

describe('pageCacheKey', () => {
    it('includes the query string so distinct queries do not collide', () => {
        const a = pageCacheKey(new URL('https://x.test/search?q=a'));
        const b = pageCacheKey(new URL('https://x.test/search?q=b'));
        expect(a).toBe('/search?q=a');
        expect(b).toBe('/search?q=b');
        expect(a).not.toBe(b);
    });

    it('is just the pathname when there is no query', () => {
        expect(pageCacheKey(new URL('https://x.test/about'))).toBe('/about');
    });
});
