import { describe, it, expect, vi } from 'vitest';
import { singleFlight } from '../utils/single-flight';

describe('singleFlight', () => {
    it('coalesces concurrent calls for the same key into one execution', async () => {
        let resolveFn: (v: number) => void;
        const fn = vi.fn(
            () => new Promise<number>((r) => (resolveFn = r)),
        );
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
});
