const inflight = new Map<string, Promise<unknown>>();

/**
 * Coalesce concurrent calls for the same `key` into a single execution of
 * `fn` ("single-flight"). While a call is in flight, every other caller with
 * the same key receives the same pending promise instead of re-running `fn`;
 * once it settles, the next call runs fresh.
 *
 * The in-flight entry is cleared on both resolve and reject (so a failed call
 * doesn't poison the key). A given key never has two live promises at once —
 * concurrent callers share the registered one — so the settle handler can clear
 * the key unconditionally.
 *
 * @param key - Identity the concurrent callers share (e.g. a full cache key).
 * @param fn - The work to run at most once for the current flight.
 * @returns The shared result promise.
 */
export const singleFlight = <T>(
    key: string,
    fn: () => Promise<T>,
): Promise<T> => {
    const existing = inflight.get(key) as Promise<T> | undefined;
    if (existing) return existing;

    const promise = fn().finally(() => inflight.delete(key));
    inflight.set(key, promise);
    return promise;
};
