import { describe, it, expect, afterEach } from 'vitest';
import {
    resolveLoaderTimeout,
    runWithLoaderTimeout,
    LoaderTimeoutError,
} from '../utils/loader-timeout';

const g = globalThis as { __SOLIDSTEP_CONFIG__?: { loaderTimeout?: number } };

describe('resolveLoaderTimeout', () => {
    afterEach(() => {
        g.__SOLIDSTEP_CONFIG__ = undefined;
    });

    it('uses a positive per-loader option', () => {
        expect(resolveLoaderTimeout(500)).toBe(500);
    });

    it('treats a 0 option as explicitly disabled, ignoring the global default', () => {
        g.__SOLIDSTEP_CONFIG__ = { loaderTimeout: 999 };
        expect(resolveLoaderTimeout(0)).toBeUndefined();
    });

    it('falls back to the global default when no option is given', () => {
        g.__SOLIDSTEP_CONFIG__ = { loaderTimeout: 250 };
        expect(resolveLoaderTimeout()).toBe(250);
    });

    it('returns undefined when neither option nor global is set', () => {
        expect(resolveLoaderTimeout()).toBeUndefined();
    });
});

describe('runWithLoaderTimeout', () => {
    it('runs work with no signal when there is no timeout or parent', async () => {
        const seen: (AbortSignal | undefined)[] = [];
        const result = await runWithLoaderTimeout(async (signal) => {
            seen.push(signal);
            return 'ok';
        }, {});
        expect(result).toBe('ok');
        expect(seen[0]).toBeUndefined();
    });

    it('passes the parent signal through when there is no timeout', async () => {
        const controller = new AbortController();
        const seen: (AbortSignal | undefined)[] = [];
        await runWithLoaderTimeout(
            async (signal) => {
                seen.push(signal);
                return 1;
            },
            { parentSignal: controller.signal },
        );
        expect(seen[0]).toBe(controller.signal);
    });

    it('resolves with the work result when it finishes before the timeout', async () => {
        const result = await runWithLoaderTimeout(async () => 'fast', {
            timeoutMs: 1000,
        });
        expect(result).toBe('fast');
    });

    it('rejects with LoaderTimeoutError when work exceeds the timeout', async () => {
        const promise = runWithLoaderTimeout(
            () => new Promise<string>(() => undefined),
            { timeoutMs: 10 },
        );
        await expect(promise).rejects.toBeInstanceOf(LoaderTimeoutError);
        await expect(promise).rejects.toThrow('10ms');
    });

    it('propagates the work rejection', async () => {
        const promise = runWithLoaderTimeout(
            async () => {
                throw new Error('boom');
            },
            { timeoutMs: 1000 },
        );
        await expect(promise).rejects.toThrow('boom');
    });

    it('rejects with the parent reason when the parent aborts before the timeout', async () => {
        const controller = new AbortController();
        const reason = new Error('client gone');
        const promise = runWithLoaderTimeout(
            () => new Promise<string>(() => undefined),
            { timeoutMs: 50, parentSignal: controller.signal },
        );
        controller.abort(reason);
        await expect(promise).rejects.toBe(reason);
    });
});
