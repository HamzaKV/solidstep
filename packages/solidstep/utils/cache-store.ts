import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { serialize, deserialize } from 'seroval';
import { SEROVAL_PLUGINS } from './serialize';

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
    prev?: Node<T>;
    next?: Node<T>;
};

const DEFAULT_MAX_ENTRIES = 1000;

/**
 * In-memory LRU cache store (the default). Backed by a `Map` plus a
 * doubly-linked list for O(1) least-recently-used eviction, with a reverse
 * tag index for {@link invalidateTag}. Per-process only.
 */
export class MemoryCacheStore implements CacheStore {
    private map = new Map<string, Node>();
    private head?: Node;
    private tail?: Node;
    private tagIndex = new Map<string, Set<string>>();
    private maxEntries: number;

    constructor(opts?: { maxEntries?: number }) {
        this.maxEntries = opts?.maxEntries ?? DEFAULT_MAX_ENTRIES;
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
        // Only called when size > maxEntries, so tail and tail.prev are defined.
        const evicted = this.tail!;
        this.map.delete(evicted.key);
        this.untag(evicted.key, evicted.tags);
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
        const existing = this.map.get(key);
        if (existing) {
            // Drop stale tag associations before re-tagging.
            this.untag(key, existing.tags);
            existing.value = value;
            existing.expiresAt = expiresAt;
            existing.staleAt = staleAt;
            existing.tags = tags;
            this.moveToFront(existing);
        } else {
            const node: Node<T> = {
                key,
                value,
                expiresAt,
                staleAt,
                tags,
                next: this.head as Node<T> | undefined,
            };
            if (this.head) this.head.prev = node as Node;
            this.head = node as Node;
            if (!this.tail) this.tail = node as Node;
            this.map.set(key, node as Node);
            if (this.map.size > this.maxEntries) this.removeTail();
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
    }

    delete(key: string): void {
        const node = this.map.get(key);
        if (!node) return;
        this.unlink(node);
        this.map.delete(key);
        this.untag(key, node.tags);
    }

    clear(): void {
        this.map.clear();
        this.tagIndex.clear();
        this.head = this.tail = undefined;
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

    constructor(opts: { dir: string }) {
        this.dir = opts.dir;
        this.tagsFile = join(this.dir, '__tags.json');
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
        } catch {
            return {};
        }
    }

    private async writeTags(index: Record<string, string[]>): Promise<void> {
        await writeFile(this.tagsFile, JSON.stringify(index), 'utf-8');
    }

    async get<T>(key: string): Promise<CacheEntry<T> | null> {
        try {
            const raw = await readFile(this.fileFor(key), 'utf-8');
            return deserialize(raw) as CacheEntry<T>;
        } catch {
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
            const index = await this.readTags();
            for (const tag of options.tags) {
                const keys = index[tag] ?? [];
                if (!keys.includes(key)) keys.push(key);
                index[tag] = keys;
            }
            await this.writeTags(index);
        }
    }

    async delete(key: string): Promise<void> {
        try {
            await unlink(this.fileFor(key));
        } catch {
            // Missing file is a no-op.
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
        delete index[tag];
        await this.writeTags(index);
    }
}
