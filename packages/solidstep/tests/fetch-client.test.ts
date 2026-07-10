import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fetch from '../utils/fetch.client';

beforeEach(() => {
    vi.useFakeTimers();
});
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

// A never-resolving fetch that rejects once its signal is aborted -- matching
// real fetch's behavior for an AbortController-driven timeout.
const abortableFetchStub = () =>
    vi.fn(
        (_url: string, opts: { signal: AbortSignal }) =>
            new Promise((_resolve, reject) => {
                opts.signal.addEventListener('abort', () =>
                    reject(new DOMException('Aborted', 'AbortError')),
                );
            }),
    );

describe('Fetch timeout vs serverAction', () => {
    it('rejects with a Timeout error when serverAction is not set', async () => {
        vi.stubGlobal('fetch', abortableFetchStub());
        const promise = Fetch('https://x.test/', {
            method: 'GET',
            MAX_FETCH_TIME: 10,
        });
        const assertion = expect(promise).rejects.toThrow('Timeout');
        await vi.advanceTimersByTimeAsync(10);
        await assertion;
    });

    it('returns (not throws) the Timeout error when serverAction is set — same contract as every other error', async () => {
        vi.stubGlobal('fetch', abortableFetchStub());
        const promise = Fetch('https://x.test/', {
            method: 'GET',
            MAX_FETCH_TIME: 10,
            serverAction: true,
        });
        await vi.advanceTimersByTimeAsync(10);
        const result = await promise;
        expect(result).toBeInstanceOf(Error);
        expect((result as Error).message).toBe('Timeout');
    });
});
