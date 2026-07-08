import { describe, it, expect, vi, beforeEach } from 'vitest';

// rate-limit imports cache.ts, which pulls in vinxi/http for revalidatePath.
vi.mock('vinxi/http', () => ({
    getEvent: vi.fn(),
    setResponseHeader: vi.fn(),
}));

import { checkRateLimit, rateLimit } from '../utils/rate-limit';
import { clearAllCache, getCacheStore, setCacheStore } from '../utils/cache';

beforeEach(async () => {
    await clearAllCache();
});

// biome-ignore lint/suspicious/noExplicitAny: tests pass minimal fake H3 events.
const fakeEvent = (over: any = {}) => over;

describe('checkRateLimit', () => {
    it('allows requests up to max, then limits', async () => {
        const opts = { windowMs: 1000, max: 2 };
        expect((await checkRateLimit('k', opts)).limited).toBe(false);
        expect((await checkRateLimit('k', opts)).limited).toBe(false);
        const third = await checkRateLimit('k', opts);
        expect(third.limited).toBe(true);
        expect(third.retryAfterSeconds).toBeGreaterThan(0);
    });

    it('keys are independent', async () => {
        const opts = { windowMs: 1000, max: 1 };
        expect((await checkRateLimit('a', opts)).limited).toBe(false);
        expect((await checkRateLimit('b', opts)).limited).toBe(false);
    });

    it('does not lose increments to a read-modify-write race under concurrent same-key calls', async () => {
        const opts = { windowMs: 1000, max: 5 };
        const N = 20;
        const results = await Promise.all(
            Array.from({ length: N }, () => checkRateLimit('burst', opts)),
        );
        const allowed = results.filter((r) => !r.limited).length;
        expect(allowed).toBe(opts.max);
        // A final, sequential call should report the count as N + 1 (limited),
        // proving no increment from the concurrent burst was lost.
        const final = await checkRateLimit('burst', opts);
        expect(final.limited).toBe(true);
    });

    it("doesn't wedge later same-key calls when an earlier one's store operation rejects", async () => {
        const original = getCacheStore();
        let failNext = true;
        const flaky: any = {
            get: (key: string) => {
                if (failNext) {
                    failNext = false;
                    throw new Error('store down');
                }
                return original.get(key);
            },
            set: (...a: unknown[]) => (original.set as any)(...a),
            delete: (...a: unknown[]) => (original.delete as any)(...a),
            clear: (...a: unknown[]) => (original.clear as any)(...a),
            invalidateTag: (...a: unknown[]) =>
                (original.invalidateTag as any)(...a),
        };
        setCacheStore(flaky);
        try {
            const opts = { windowMs: 1000, max: 5 };
            await expect(checkRateLimit('flaky-key', opts)).rejects.toThrow(
                'store down',
            );
            const result = await checkRateLimit('flaky-key', opts);
            expect(result.limited).toBe(false);
        } finally {
            setCacheStore(original);
        }
    });

    it('resets after the window expires', async () => {
        vi.useFakeTimers();
        try {
            const opts = { windowMs: 1000, max: 1 };
            expect((await checkRateLimit('k', opts)).limited).toBe(false);
            expect((await checkRateLimit('k', opts)).limited).toBe(true);
            vi.advanceTimersByTime(1500);
            expect((await checkRateLimit('k', opts)).limited).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('rateLimit middleware', () => {
    it('returns a 429 with Retry-After once the limit is exceeded', async () => {
        const mw = rateLimit({ windowMs: 1000, max: 1, key: () => 'fixed' });
        expect(await mw.onRequest?.(fakeEvent())).toBeUndefined();
        const res = await mw.onRequest?.(fakeEvent());
        expect(res).toBeInstanceOf(Response);
        expect((res as Response).status).toBe(429);
        expect((res as Response).headers.get('Retry-After')).toBeTruthy();
    });

    it('derives the key from x-forwarded-for by default', async () => {
        const mw = rateLimit({ windowMs: 1000, max: 100 });
        const event = fakeEvent({
            node: {
                req: {
                    headers: { 'x-forwarded-for': '9.9.9.9, 1.1.1.1' },
                    socket: {},
                },
            },
        });
        expect(await mw.onRequest?.(event)).toBeUndefined();
    });

    it('pins the current (spoofable) trust of the client-supplied X-Forwarded-For first hop', async () => {
        // Without a stripping/overwriting reverse proxy in front, a client
        // talking to the app directly can set this header to anything --
        // trivially resetting its own bucket by claiming a new IP each
        // request. This test documents that as known, intentional behavior
        // (see docs/security.md), not a regression to silently "fix" later.
        const mw = rateLimit({ windowMs: 60_000, max: 1 });
        const requestFrom = (ip: string) =>
            mw.onRequest?.(
                fakeEvent({
                    node: {
                        req: {
                            headers: { 'x-forwarded-for': ip },
                            socket: { remoteAddress: '10.0.0.1' },
                        },
                    },
                }),
            );

        expect(await requestFrom('1.1.1.1')).toBeUndefined();
        const limited = await requestFrom('1.1.1.1');
        expect((limited as Response).status).toBe(429);

        // Same real client, a freely-chosen spoofed header -- bypasses the
        // limit entirely.
        expect(await requestFrom('2.2.2.2')).toBeUndefined();
    });

    it('falls back to the socket address, then to "unknown"', async () => {
        const mw = rateLimit({ windowMs: 1000, max: 100 });
        await mw.onRequest?.(
            fakeEvent({
                node: {
                    req: { headers: {}, socket: { remoteAddress: '2.2.2.2' } },
                },
            }),
        );
        await mw.onRequest?.(
            fakeEvent({ node: { req: { headers: {}, socket: {} } } }),
        );
        await mw.onRequest?.(fakeEvent());
    });
});
