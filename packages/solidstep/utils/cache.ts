import { getEvent, setResponseHeader } from 'vinxi/http';

type CacheValue<T = any> = {
    key: string
    value: T
    expiresAt: number | null
    prev?: CacheValue<T>
    next?: CacheValue<T>
};

const MAX_CACHE_ENTRIES = 1000;

const cacheMap = new Map<string, CacheValue>();
let head: CacheValue | undefined;
let tail: CacheValue | undefined;

const moveToFront = <T>(node: CacheValue<T>) => {
    if (node === head) return;

    // Detach
    if (node.prev) node.prev.next = node.next;
    if (node.next) node.next.prev = node.prev;

    if (node === tail) tail = node.prev;

    // Insert at head
    node.prev = undefined;
    node.next = head;
    if (head) head.prev = node;
    head = node;

    if (!tail) tail = node;
};

const removeTail = <T>() => {
    if (!tail) return;
    cacheMap.delete(tail.key);

    if (tail.prev) {
        tail.prev.next = undefined;
        tail = tail.prev;
    } else {
        // Only one node
        head = tail = undefined;
    }
};

export const getCache = <T>(key: string): T | null => {
    const entry = cacheMap.get(key);
    if (!entry || !entry.expiresAt) return null;

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
        expiresAt: ttlMs ? performance.now() + ttlMs : null
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

export const invalidateCache = (key: string) => {
    const node = cacheMap.get(key);
    if (!node) return;

    if (node.prev) node.prev.next = node.next;
    if (node.next) node.next.prev = node.prev;
    if (node === head) head = node.next;
    if (node === tail) tail = node.prev;

    cacheMap.delete(key);
};

export const clearAllCache = () => {
    cacheMap.clear();
    head = tail = undefined;
};

export const revalidatePath = (path: string) => {
    // get and verify the event
    const event = getEvent();
    if (!event.path.includes('_server')) {
        throw new Error('This function can only be used in server functions.');
    }

    // add the revalidate header as a flag for the server action to do diffing 
    setResponseHeader(event, 'X-Revalidate', path);
};
