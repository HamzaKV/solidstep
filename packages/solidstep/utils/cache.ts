import { getEvent, setResponseHeader } from 'vinxi/http';

type CacheValue<T = any> = {
    key: string;
    value: T;
    expiresAt: number | null;
    prev?: CacheValue<T>;
    next?: CacheValue<T>;
};

const MAX_CACHE_ENTRIES = 1000;

const cacheMap = new Map<string, CacheValue>();
let head: CacheValue | undefined;
let tail: CacheValue | undefined;

const moveToFront = <T>(node: CacheValue<T>) => {
    if (node === head) return;

    // node.prev is always defined here: node !== head guarantees a predecessor
    node.prev!.next = node.next;
    if (node.next) node.next.prev = node.prev;
    if (node === tail) tail = node.prev;

    // head is always defined here: there are ≥2 nodes when moveToFront is reached
    node.prev = undefined;
    node.next = head;
    head!.prev = node;
    head = node;
};

// Only called when cacheMap.size > MAX_CACHE_ENTRIES, so tail and tail.prev are always defined.
const removeTail = () => {
    cacheMap.delete(tail!.key);
    tail!.prev!.next = undefined;
    tail = tail!.prev!;
};

/**
 * Read a value from the in-memory cache by key.
 *
 * Expired entries (past their TTL) are evicted on access and treated as a
 * miss. A hit moves the entry to the front of the LRU list.
 *
 * @param key - Cache key.
 * @returns The cached value, or `null` if missing or expired.
 */
export const getCache = <T>(key: string): T | null => {
    const entry = cacheMap.get(key);
    if (!entry) return null;

    if (entry.expiresAt && entry.expiresAt < performance.now()) {
        cacheMap.delete(key);
        if (entry.prev) entry.prev.next = entry.next;
        if (entry.next) entry.next.prev = entry.prev;
        if (entry === head) head = entry.next;
        if (entry === tail) tail = entry.prev;
        return null;
    }

    moveToFront(entry);
    return entry.value;
};

/**
 * Store a value in the in-memory LRU cache (max 1000 entries).
 *
 * Inserting beyond the capacity evicts the least-recently-used entry.
 *
 * @param key - Cache key. Reusing a key overwrites its value and TTL.
 * @param value - Value to cache.
 * @param ttlMs - Optional time-to-live in milliseconds. Omit for no expiry.
 */
export const setCache = <T>(key: string, value: T, ttlMs?: number) => {
    if (cacheMap.has(key)) {
        const node = cacheMap.get(key)!;
        node.value = value;
        node.expiresAt = ttlMs ? performance.now() + ttlMs : null;
        moveToFront(node);
        return;
    }

    const newNode: CacheValue<T> = {
        key,
        value,
        expiresAt: ttlMs ? performance.now() + ttlMs : null,
    };

    newNode.next = head;
    if (head) head.prev = newNode;
    head = newNode;

    if (!tail) tail = newNode;

    cacheMap.set(key, newNode);

    if (cacheMap.size > MAX_CACHE_ENTRIES) {
        removeTail();
    }
};

/**
 * Remove a single entry from the cache. No-op if the key is absent.
 *
 * @param key - Cache key to invalidate.
 */
export const invalidateCache = (key: string) => {
    const node = cacheMap.get(key);
    if (!node) return;

    if (node.prev) node.prev.next = node.next;
    if (node.next) node.next.prev = node.prev;
    if (node === head) head = node.next;
    if (node === tail) tail = node.prev;

    cacheMap.delete(key);
};

/** Empty the entire in-memory cache. */
export const clearAllCache = () => {
    cacheMap.clear();
    head = tail = undefined;
};

/**
 * Mark a path for revalidation from within a server action.
 *
 * Sets the `X-Revalidate` response header, which the server action handler
 * uses as a flag to diff and refresh the given path. Only usable inside a
 * server function (the `/_server` endpoint); throws otherwise.
 *
 * @param path - The path to revalidate.
 * @throws If called outside of a server function.
 */
export const revalidatePath = (path: string) => {
    // get and verify the event
    const event = getEvent();
    if (!event.path.includes('_server')) {
        throw new Error('This function can only be used in server functions.');
    }

    // add the revalidate header as a flag for the server action to do diffing
    setResponseHeader(event, 'X-Revalidate', path);
};
