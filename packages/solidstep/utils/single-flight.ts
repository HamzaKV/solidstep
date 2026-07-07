const inflight = new Map<string, Promise<unknown>>();

/**
 * Coalesce concurrent calls for the same `key` into a single execution of
 * `fn` ("single-flight"). While a call is in flight, every other caller with
 * the same key receives the same pending promise instead of re-running `fn`;
 * once it settles, the next call runs fresh.
 *
 * The in-flight entry is cleared on both resolve and reject (so a failed call
 * doesn't poison the key). A given key never has two live promises at once —
 * concurrent callers share the registered one.
 *
 * **`timeoutMs`** guards against a hung `fn` (an upstream that never settles)
 * pinning the key forever: after `timeoutMs` the entry is evicted so the next
 * caller starts a fresh flight. The original promise keeps running and is
 * returned to its current awaiters; its later settle no longer deletes the new
 * flight's key (the eviction is identity-checked).
 *
 * @param key - Identity the concurrent callers share (e.g. a full cache key).
 * @param fn - The work to run at most once for the current flight.
 * @param timeoutMs - Optional eviction timeout in ms. Omit (or `0`) to keep the
 *   entry until `fn` settles.
 * @returns The shared result promise.
 */
export const singleFlight = <T>(
    key: string,
    fn: () => Promise<T>,
    timeoutMs?: number,
): Promise<T> => {
    const existing = inflight.get(key) as Promise<T> | undefined;
    if (existing) return existing;

    let timer: ReturnType<typeof setTimeout> | undefined;
    // Only the flight that is still the registered one may clear the key — so a
    // timed-out flight's late settle can't evict a newer flight under the key.
    const evict = () => {
        if (inflight.get(key) === tracked) inflight.delete(key);
    };
    // Wrapped in an async IIFE so a synchronously-throwing (non-async) fn
    // still produces a rejected promise instead of throwing out of
    // singleFlight itself, matching the always-a-Promise contract.
    const tracked: Promise<T> = (async () => fn())().finally(() => {
        if (timer !== undefined) clearTimeout(timer);
        evict();
    });
    inflight.set(key, tracked);
    if (timeoutMs !== undefined && timeoutMs > 0) {
        timer = setTimeout(evict, timeoutMs);
    }
    return tracked;
};
