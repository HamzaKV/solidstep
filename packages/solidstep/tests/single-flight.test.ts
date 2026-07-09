import { describe, it, expect, vi } from 'vitest';
import { singleFlight } from '../utils/single-flight';

describe('singleFlight', () => {
    it('coalesces concurrent calls for the same key into one execution', async () => {
        let resolveFn: (v: number) => void;
        const fn = vi.fn(() => new Promise<number>((r) => (resolveFn = r)));
        const a = singleFlight('k', fn);
        const b = singleFlight('k', fn); // shares the in-flight promise
        expect(fn).toHaveBeenCalledTimes(1);
        resolveFn!(42);
        expect(await a).toBe(42);
        expect(await b).toBe(42);
    });

    it('runs fresh again after the previous flight settles', async () => {
        const fn = vi.fn(async () => 'v');
        await singleFlight('k', fn);
        await singleFlight('k', fn);
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it('clears the key after a rejection so it can be retried', async () => {
        const fn = vi
            .fn()
            .mockRejectedValueOnce(new Error('boom'))
            .mockResolvedValueOnce('ok');
        await expect(singleFlight('k', fn)).rejects.toThrow('boom');
        await expect(singleFlight('k', fn)).resolves.toBe('ok');
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it('returns a rejected promise (not a synchronous throw) when fn throws synchronously', async () => {
        const fn = () => {
            throw new Error('sync boom');
        };
        await expect(singleFlight('sync-throw', fn as any)).rejects.toThrow(
            'sync boom',
        );
        // The key must still be cleared so a retry can run fresh.
        const retry = vi.fn(async () => 'ok');
        await expect(singleFlight('sync-throw', retry)).resolves.toBe('ok');
    });

    it('keeps distinct keys independent', async () => {
        const fnA = vi.fn(async () => 'a');
        const fnB = vi.fn(async () => 'b');
        const [a, b] = await Promise.all([
            singleFlight('a', fnA),
            singleFlight('b', fnB),
        ]);
        expect(a).toBe('a');
        expect(b).toBe('b');
    });

    describe('timeout eviction', () => {
        it('evicts a hung flight after timeoutMs so the next caller runs fresh', async () => {
            vi.useFakeTimers();
            try {
                let resolveFirst: (v: string) => void;
                const fn = vi
                    .fn()
                    .mockImplementationOnce(
                        () =>
                            new Promise<string>((r) => {
                                resolveFirst = r;
                            }),
                    )
                    .mockResolvedValueOnce('second');
                const first = singleFlight('t', fn, 50);
                // Still in flight before the timeout: coalesced.
                singleFlight('t', fn, 50);
                expect(fn).toHaveBeenCalledTimes(1);

                // After the timeout the key is evicted; the next call runs fresh.
                vi.advanceTimersByTime(50);
                const second = singleFlight('t', fn, 50);
                expect(fn).toHaveBeenCalledTimes(2);
                expect(await second).toBe('second');

                // The original promise still resolves to its awaiters and its
                // late settle must not evict the new flight's key.
                resolveFirst!('first');
                expect(await first).toBe('first');
            } finally {
                vi.useRealTimers();
            }
        });

        it('clears the timer when the flight settles before the timeout', async () => {
            vi.useFakeTimers();
            try {
                const fn = vi.fn(async () => 'ok');
                const p = singleFlight('t2', fn, 1000);
                expect(await p).toBe('ok');
                // Settled → key cleared, next call runs fresh (timer was cleared).
                await singleFlight('t2', fn, 1000);
                expect(fn).toHaveBeenCalledTimes(2);
                expect(vi.getTimerCount()).toBe(0);
            } finally {
                vi.useRealTimers();
            }
        });

        it('treats timeoutMs of 0 as no timeout (no timer scheduled)', async () => {
            vi.useFakeTimers();
            try {
                const fn = vi.fn(async () => 'x');
                const p = singleFlight('t3', fn, 0);
                expect(vi.getTimerCount()).toBe(0);
                expect(await p).toBe('x');
            } finally {
                vi.useRealTimers();
            }
        });
    });

    describe('load: high concurrency across many interleaved keys', () => {
        it('runs each of many keys exactly once despite a large truly-concurrent burst of callers per key', async () => {
            const KEY_COUNT = 100;
            const CALLERS_PER_KEY = 20;
            const execCounts = new Map<string, number>();
            const keys = Array.from(
                { length: KEY_COUNT },
                (_, i) => `flight-${i}`,
            );

            const fnFor = (key: string) => async () => {
                execCounts.set(key, (execCounts.get(key) ?? 0) + 1);
                // A real async delay (macrotask, not just a microtask) so
                // callers genuinely interleave across keys while each
                // flight is in progress, not just resolve synchronously.
                await new Promise((r) => setTimeout(r, 1));
                return `result-${key}`;
            };

            // Interleaved (round-major) so it's not just N sequential
            // bursts per key -- every key has an in-flight call while
            // every OTHER key also does.
            const calls: Promise<string>[] = [];
            for (let round = 0; round < CALLERS_PER_KEY; round++) {
                for (const key of keys) {
                    calls.push(singleFlight(key, fnFor(key)));
                }
            }
            const results = await Promise.all(calls);

            for (const key of keys) {
                expect(execCounts.get(key), key).toBe(1);
            }
            for (let i = 0; i < results.length; i++) {
                const key = keys[i % KEY_COUNT];
                expect(results[i], `call ${i}`).toBe(`result-${key}`);
            }
        });
    });
});
