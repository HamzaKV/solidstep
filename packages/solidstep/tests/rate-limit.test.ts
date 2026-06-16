import { describe, it, expect, vi, beforeEach } from 'vitest';

// rate-limit imports cache.ts, which pulls in vinxi/http for revalidatePath.
vi.mock('vinxi/http', () => ({
    getEvent: vi.fn(),
    setResponseHeader: vi.fn(),
}));

import { checkRateLimit, rateLimit } from '../utils/rate-limit';
import { clearAllCache } from '../utils/cache';

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
