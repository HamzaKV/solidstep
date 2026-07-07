import { createHash } from 'node:crypto';
import {
    mkdir,
    readFile,
    writeFile,
    unlink,
    rm,
    rename,
} from 'node:fs/promises';
import { join } from 'node:path';
import { serialize, deserialize } from 'seroval';
import { SEROVAL_PLUGINS } from './serialize.js';
import { logger } from './logger.js';

/** A value that may be returned synchronously or as a promise. */
export type MaybePromise<T> = T | Promise<T>;

/**
 * A single cache entry. Timestamps are absolute **wall-clock** epoch
 * milliseconds (`Date.now()`-based), so they survive serialization and a
 * process restart — unlike the monotonic `performance.now()` clock.
 */
export interface CacheEntry<T = unknown> {
    /** The cached value. */
    value: T;
    /**
     * Epoch ms at which the entry hard-expires (becomes a miss). `null` = never
     * expires.
     */
    expiresAt: number | null;
    /**
     * Epoch ms after which the entry is stale but still served while it
     * revalidates in the background (SWR). `null` = never goes stale. When no
     * `swr` window is configured this equals `expiresAt`.
     */
    staleAt: number | null;
    /** Tags this entry belongs to, for group invalidation via {@link CacheStore.invalidateTag}. */
    tags?: string[];
}

/** Options accepted when writing an entry through a {@link CacheStore}. */
export interface CacheSetOptions {
    /** Hard TTL in milliseconds (wall-clock). `0`/omitted = no expiry. */
    ttl?: number;
    /**
     * Stale-while-revalidate window in milliseconds, applied *after* `ttl`. The
     * entry is served stale during this window while it revalidates. Ignored
     * when `ttl` is `0`/omitted.
     */
    swr?: number;
    /** Tags to associate with the entry for group invalidation. */
    tags?: string[];
}

/**
 * Pluggable cache backend. A store is a dumb key → {@link CacheEntry} map: it
 * stores entries (computing their absolute deadlines from {@link CacheSetOptions}
 * on `set`) and hands them back on `get` **without** enforcing expiry — the
 * caller (`utils/cache`) owns the freshness/SWR semantics so the behavior is
 * identical across every adapter.
 *
 * Every method may be synchronous or async, so an in-memory adapter stays
 * cheap while filesystem/Redis adapters can return promises.
 *
 * ## Writing an external adapter
 * Implement all five methods. On `set`, compute and persist the entry's
 * `expiresAt`/`staleAt` (see {@link MemoryCacheStore.set} for the formula) so
 * deadlines survive a restart. Maintain your own tag → keys reverse index for
 * `invalidateTag` (e.g. a Redis SET per tag). Serialize {@link CacheEntry}
 * yourself — `seroval` is recommended as it matches the framework's wire
 * format and round-trips non-plain values. Register the instance at runtime
 * via `setCacheStore(store)` inside your instrumentation `register()` hook.
 */
export interface CacheStore {
    /** Read an entry. Returns `null` on a miss. Does not enforce expiry. */
    get<T>(key: string): MaybePromise<CacheEntry<T> | null>;
    /** Write an entry, computing its deadlines from `options`. */
    set<T>(
        key: string,
        value: T,
        options?: CacheSetOptions,
    ): MaybePromise<void>;
    /** Remove a single entry. No-op when absent. */
    delete(key: string): MaybePromise<void>;
    /** Remove every entry. */
    clear(): MaybePromise<void>;
    /** Remove every entry associated with `tag`. */
    invalidateTag(tag: string): MaybePromise<void>;
}

/**
 * Compute an entry's absolute wall-clock deadlines from set options.
 *
 * - no/zero `ttl` → never expires (`staleAt`/`expiresAt` are `null`).
 * - `ttl` only → `staleAt === expiresAt` (a plain TTL, empty stale window).
 * - `ttl` + `swr` → fresh until `staleAt`, served stale until `expiresAt`.
 */
const computeDeadlines = (
    options?: CacheSetOptions,
): { expiresAt: number | null; staleAt: number | null } => {
    const ttl = options?.ttl ?? 0;
    if (ttl <= 0) return { expiresAt: null, staleAt: null };
    const swr = options?.swr ?? 0;
    const now = Date.now();
    return { staleAt: now + ttl, expiresAt: now + ttl + swr };
};

// ============================================================================
// In-memory LRU adapter
// ============================================================================

type Node<T = unknown> = CacheEntry<T> & {
    key: string;
    /** Approximate byte size of `value`, tracked only when `maxBytes` is set. */
    size: number;
    prev?: Node<T>;
    next?: Node<T>;
};

const DEFAULT_MAX_ENTRIES = 1000;

/**
 * In-memory LRU cache store (the default). Backed by a `Map` plus a
 * doubly-linked list for O(1) least-recently-used eviction, with a reverse
 * tag index for {@link invalidateTag}. Per-process only.
 *
 * Evicts the least-recently-used entry when either bound is exceeded:
 * `maxEntries` (a count) and, optionally, `maxBytes` (an approximate total
 * value size). `maxBytes` guards memory-constrained runtimes where a 1000-entry
 * count limit can still hold far more than expected when entries vary wildly in
 * size (e.g. cached HTML). The newest entry is always kept even if it alone
 * exceeds `maxBytes`.
 */
export class MemoryCacheStore implements CacheStore {
    private map = new Map<string, Node>();
    private head?: Node;
    private tail?: Node;
    private tagIndex = new Map<string, Set<string>>();
    private maxEntries: number;
    private maxBytes: number;
    private totalBytes = 0;

    constructor(opts?: { maxEntries?: number; maxBytes?: number }) {
        this.maxEntries = opts?.maxEntries ?? DEFAULT_MAX_ENTRIES;
        this.maxBytes = opts?.maxBytes ?? Number.POSITIVE_INFINITY;
    }

    /**
     * Approximate byte size of a value. Only computed when `maxBytes` is set
     * (otherwise sizes are irrelevant), via the seroval encoding the framework
     * already uses — accurate enough for eviction and robust to Date/Map/Set.
     */
    private sizeOf(value: unknown): number {
        if (this.maxBytes === Number.POSITIVE_INFINITY) return 0;
        try {
            return serialize(value, { plugins: SEROVAL_PLUGINS }).length;
        } catch (err) {
            // An unserializable value can't be byte-counted; it still gets
            // cached (size 0), but that defeats the maxBytes bound, so surface it.
            logger.warn(
                { err },
                'MemoryCacheStore: failed to size a cache value; counting it as 0 bytes',
            );
            return 0;
        }
    }

    /** Evict from the LRU tail until both bounds are satisfied (keep ≥1 entry). */
    private evictToBounds() {
        while (
            this.tail &&
            (this.map.size > this.maxEntries ||
                (this.totalBytes > this.maxBytes && this.map.size > 1))
        ) {
            this.removeTail();
        }
    }

    private moveToFront(node: Node) {
        if (node === this.head) return;
        // node.prev is defined: node !== head guarantees a predecessor.
        node.prev!.next = node.next;
        if (node.next) node.next.prev = node.prev;
        if (node === this.tail) this.tail = node.prev;
        node.prev = undefined;
        node.next = this.head;
        // head is defined: there are ≥2 nodes when moveToFront is reached.
        this.head!.prev = node;
        this.head = node;
    }

    private removeTail() {
        // Only called when a bound is exceeded, so tail and tail.prev are defined.
        const evicted = this.tail!;
        this.map.delete(evicted.key);
        this.untag(evicted.key, evicted.tags);
        this.totalBytes -= evicted.size;
        this.tail = evicted.prev!;
        this.tail.next = undefined;
    }

    private untag(key: string, tags?: string[]) {
        if (!tags) return;
        for (const tag of tags) {
            const set = this.tagIndex.get(tag);
            if (!set) continue;
            set.delete(key);
            if (set.size === 0) this.tagIndex.delete(tag);
        }
    }

    private unlink(node: Node) {
        if (node.prev) node.prev.next = node.next;
        if (node.next) node.next.prev = node.prev;
        if (node === this.head) this.head = node.next;
        if (node === this.tail) this.tail = node.prev;
    }

    get<T>(key: string): CacheEntry<T> | null {
        const node = this.map.get(key);
        if (!node) return null;
        this.moveToFront(node);
        return node as unknown as CacheEntry<T>;
    }

    set<T>(key: string, value: T, options?: CacheSetOptions): void {
        const { expiresAt, staleAt } = computeDeadlines(options);
        const tags = options?.tags;
        const size = this.sizeOf(value);
        const existing = this.map.get(key);
        if (existing) {
            // Drop stale tag associations before re-tagging.
            this.untag(key, existing.tags);
            this.totalBytes += size - existing.size;
            existing.value = value;
            existing.size = size;
            existing.expiresAt = expiresAt;
            existing.staleAt = staleAt;
            existing.tags = tags;
            this.moveToFront(existing);
        } else {
            const node: Node<T> = {
                key,
                value,
                size,
                expiresAt,
                staleAt,
                tags,
                next: this.head as Node<T> | undefined,
            };
            if (this.head) this.head.prev = node as Node;
            this.head = node as Node;
            if (!this.tail) this.tail = node as Node;
            this.map.set(key, node as Node);
            this.totalBytes += size;
        }
        if (tags) {
            for (const tag of tags) {
                let set = this.tagIndex.get(tag);
                if (!set) {
                    set = new Set();
                    this.tagIndex.set(tag, set);
                }
                set.add(key);
            }
        }
        this.evictToBounds();
    }

    delete(key: string): void {
        const node = this.map.get(key);
        if (!node) return;
        this.unlink(node);
        this.map.delete(key);
        this.untag(key, node.tags);
        this.totalBytes -= node.size;
    }

    clear(): void {
        this.map.clear();
        this.tagIndex.clear();
        this.head = this.tail = undefined;
        this.totalBytes = 0;
    }

    invalidateTag(tag: string): void {
        const set = this.tagIndex.get(tag);
        if (!set) return;
        // Copy first: delete() mutates tagIndex as it scrubs each key.
        for (const key of [...set]) this.delete(key);
        this.tagIndex.delete(tag);
    }
}

// ============================================================================
// Filesystem adapter
// ============================================================================

const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');

/**
 * Filesystem-backed cache store. Persists one `seroval`-serialized file per
 * key under `dir`, plus a `__tags.json` reverse index for `invalidateTag`.
 * Read/parse failures are treated as a cache miss.
 *
 * Intended for node-server presets — it writes to disk, so it does **not**
 * work on read-only edge/serverless runtimes. Use {@link MemoryCacheStore} or
 * an external store there.
 */
export class FilesystemCacheStore implements CacheStore {
    private dir: string;
    private tagsFile: string;
    private ready?: Promise<void>;
    private tmpSeq = 0;
    // Serializes every read-modify-write of the tags file (set/delete/
    // invalidateTag all do one): without this, concurrent writers can
    // corrupt the swap (Windows' rename() rejects a concurrent rename onto
    // the same destination, unlike POSIX's atomic replace).
    private tagsLock: Promise<unknown> = Promise.resolve();

    constructor(opts: { dir: string }) {
        this.dir = opts.dir;
        this.tagsFile = join(this.dir, '__tags.json');
    }

    private withTagsLock<T>(fn: () => Promise<T>): Promise<T> {
        const run = this.tagsLock.then(fn, fn);
        this.tagsLock = run.catch(() => undefined);
        return run;
    }

    private ensureDir(): Promise<void> {
        if (!this.ready) {
            this.ready = mkdir(this.dir, { recursive: true }).then(
                () => undefined,
            );
        }
        return this.ready;
    }

    private fileFor(key: string) {
        return join(this.dir, `${hashKey(key)}.cache`);
    }

    private async readTags(): Promise<Record<string, string[]>> {
        try {
            return JSON.parse(await readFile(this.tagsFile, 'utf-8'));
        } catch (err) {
            // A missing index is normal (first run). Anything else (a truncated
            // or corrupt index) would silently break invalidateTag, so log it.
            logger.debug(
                { err },
                'FilesystemCacheStore: tag index unreadable; treating as empty',
            );
            return {};
        }
    }

    private async writeTags(index: Record<string, string[]>): Promise<void> {
        // Write to a unique temp file then atomically rename over the index, so
        // a crash mid-write can't leave a truncated/torn `__tags.json` that
        // breaks every later `invalidateTag`. The reader tolerates a missing
        // file (treats it as empty), so the swap is always consistent.
        const tmp = `${this.tagsFile}.${process.pid}.${this.tmpSeq++}.tmp`;
        await writeFile(tmp, JSON.stringify(index), 'utf-8');
        await rename(tmp, this.tagsFile);
    }

    async get<T>(key: string): Promise<CacheEntry<T> | null> {
        try {
            const raw = await readFile(this.fileFor(key), 'utf-8');
            return deserialize(raw) as CacheEntry<T>;
        } catch (err) {
            // A missing file is an ordinary cache miss; a deserialize failure is
            // a corrupt entry. Both resolve to a miss — log at debug so it's
            // diagnosable without being noisy in production.
            logger.debug({ err }, 'FilesystemCacheStore: cache read miss');
            return null;
        }
    }

    async set<T>(
        key: string,
        value: T,
        options?: CacheSetOptions,
    ): Promise<void> {
        await this.ensureDir();
        const { expiresAt, staleAt } = computeDeadlines(options);
        const entry: CacheEntry<T> = {
            value,
            expiresAt,
            staleAt,
            tags: options?.tags,
        };
        await writeFile(
            this.fileFor(key),
            serialize(entry, { plugins: SEROVAL_PLUGINS }),
            'utf-8',
        );
        if (options?.tags?.length) {
            const tags = options.tags;
            await this.withTagsLock(async () => {
                const index = await this.readTags();
                for (const tag of tags) {
                    const keys = index[tag] ?? [];
                    if (!keys.includes(key)) keys.push(key);
                    index[tag] = keys;
                }
                await this.writeTags(index);
            });
        }
    }

    async delete(key: string): Promise<void> {
        // Read the entry first (while it still exists) so a tagged key can be
        // pruned from the tag index below — otherwise a direct delete (e.g. via
        // revalidatePath, not invalidateTag) leaves a stale reference forever.
        const entry = await this.get(key);
        try {
            await unlink(this.fileFor(key));
        } catch (err) {
            // Missing file is a no-op; any other unlink failure (e.g. a
            // permission error) leaves a stale entry, so make it diagnosable.
            logger.debug(
                { err },
                'FilesystemCacheStore: delete found no file to remove',
            );
        }
        if (entry?.tags?.length) {
            const tags = entry.tags;
            await this.withTagsLock(async () => {
                const index = await this.readTags();
                let changed = false;
                for (const tag of tags) {
                    const keys = index[tag];
                    if (!keys) continue;
                    const next = keys.filter((k) => k !== key);
                    changed ||= next.length !== keys.length;
                    if (next.length > 0) index[tag] = next;
                    else delete index[tag];
                }
                if (changed) await this.writeTags(index);
            });
        }
    }

    async clear(): Promise<void> {
        await rm(this.dir, { recursive: true, force: true });
        this.ready = undefined;
    }

    async invalidateTag(tag: string): Promise<void> {
        const index = await this.readTags();
        const keys = index[tag];
        if (!keys) return;
        await Promise.all(keys.map((key) => this.delete(key)));
        // Re-read rather than reuse the pre-delete snapshot: each delete()
        // above already pruned the index for its own key's tags (including
        // this one), so writing the stale snapshot here would resurrect
        // those prunes. Re-reading picks up their result before removing
        // whatever's left of this tag.
        await this.withTagsLock(async () => {
            const latest = await this.readTags();
            delete latest[tag];
            await this.writeTags(latest);
        });
    }
}
