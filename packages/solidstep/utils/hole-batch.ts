import { deserialize } from 'seroval';

/**
 * DataLoader-style microtask batcher for `/__solidstep_loader` hole fetches.
 * Collects every `fetchHoleBatched` call issued synchronously within one
 * navigation's tree walk into a single request, keyed by target URL, instead
 * of firing one `fetch()` per deferred node.
 *
 * Safety invariant this batcher depends on but does not itself enforce: at
 * most one synchronous, fetch-issuing tree walk can be in flight per URL
 * before its microtask flush runs. Guaranteed today by `router-context.ts`'s
 * `navGen` discipline (a navigation never reaches its synchronous `commit()`
 * until after an async envelope fetch, immediately re-checking staleness
 * first) plus `history.pushState` always running synchronously immediately
 * before `commit()`. If that discipline ever changes (e.g. an optimistic
 * commit before the envelope resolves), this URL-only keying needs revisiting.
 */

type Waiter = { resolve: (v: unknown) => void; reject: (e: unknown) => void };
type Batch = { queue: Map<string, Waiter[]>; scheduled: boolean };
type HoleResult = { manifest: string; data?: unknown; error?: string };

const batches = new Map<string, Batch>();

const flush = async (url: string): Promise<void> => {
    const batch = batches.get(url);
    /* v8 ignore next -- defensive: `flush` is scheduled exactly once per
       batch, immediately after that batch is created, and nothing else ever
       deletes it before this runs -- `batches.get(url)` always finds it. */
    if (!batch) return;
    // Delete synchronously, before the fetch: a fetchHoleBatched call that
    // fires WHILE this request is in flight must start a fresh batch, not
    // silently append to one whose request was already sent (which would
    // hang that manifest's promise forever with no future flush scheduled).
    batches.delete(url);
    const manifests = [...batch.queue.keys()];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    try {
        const params = new URLSearchParams({ url });
        for (const m of manifests) params.append('manifest', m);
        const res = await fetch(`/__solidstep_loader?${params}`, {
            signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Hole fetch failed (${res.status})`);
        const text = await res.text();
        const envelope = deserialize(text) as { results: HoleResult[] };
        const byManifest = new Map(
            envelope.results.map((r) => [r.manifest, r]),
        );
        for (const [manifest, waiters] of batch.queue) {
            const result = byManifest.get(manifest);
            for (const w of waiters) {
                if (!result) {
                    w.reject(new Error(`No response for hole "${manifest}"`));
                } else if (result.error !== undefined) {
                    w.reject(new Error(result.error));
                } else {
                    w.resolve(result.data);
                }
            }
        }
    } catch (err) {
        const finalErr = controller.signal.aborted ? new Error('Timeout') : err;
        for (const waiters of batch.queue.values()) {
            for (const w of waiters) w.reject(finalErr);
        }
    } finally {
        clearTimeout(timeout);
    }
};

/**
 * Enqueue one manifest's hole fetch for `url`, batched with every other
 * `fetchHoleBatched` call made synchronously (same microtask turn) for the
 * same `url`. Two nodes requesting the same manifest share one server-side
 * loader run and both resolve from it.
 */
export const fetchHoleBatched = (
    manifest: string,
    url: string,
): Promise<unknown> =>
    new Promise((resolve, reject) => {
        let batch = batches.get(url);
        if (!batch) {
            batch = { queue: new Map(), scheduled: false };
            batches.set(url, batch);
        }
        const list = batch.queue.get(manifest) ?? [];
        list.push({ resolve, reject });
        batch.queue.set(manifest, list);
        if (!batch.scheduled) {
            batch.scheduled = true;
            queueMicrotask(() => flush(url));
        }
    });
