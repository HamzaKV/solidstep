import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    mkdtempSync,
    mkdirSync,
    rmSync,
    writeFileSync,
    readdirSync,
    readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FilesystemCacheStore } from '../utils/cache-store';

let dir: string;
let store: FilesystemCacheStore;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'solidstep-cache-'));
    store = new FilesystemCacheStore({ dir });
});

afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

describe('FilesystemCacheStore', () => {
    it('round-trips a non-plain value via seroval', async () => {
        const value = { when: new Date(0), tags: new Map([['a', 1]]) };
        await store.set('k', value);
        const entry = await store.get<typeof value>('k');
        expect(entry?.value.when).toBeInstanceOf(Date);
        expect(entry?.value.when.getTime()).toBe(0);
        expect(entry?.value.tags.get('a')).toBe(1);
    });

    it('persists wall-clock deadlines', async () => {
        await store.set('d', 1, { ttl: 1000, swr: 500 });
        const entry = await store.get('d');
        expect(entry!.expiresAt! - entry!.staleAt!).toBe(500);
    });

    it('returns null for a missing key', async () => {
        expect(await store.get('absent')).toBeNull();
    });

    it('returns null for a corrupt entry file', async () => {
        await store.set('c', 1);
        // Overwrite every cache file (not the tag index) with garbage.
        for (const f of readdirSync(dir)) {
            if (f.endsWith('.cache')) {
                writeFileSync(join(dir, f), 'not-serialized', 'utf-8');
            }
        }
        expect(await store.get('c')).toBeNull();
    });

    it('deletes an entry (and tolerates deleting a missing one)', async () => {
        await store.set('x', 1);
        await store.delete('x');
        expect(await store.get('x')).toBeNull();
        await expect(store.delete('x')).resolves.toBeUndefined();
    });

    it('invalidates entries by tag', async () => {
        await store.set('p1', 1, { tags: ['posts'] });
        await store.set('p2', 2, { tags: ['posts'] });
        await store.set('u1', 3, { tags: ['users'] });
        await store.invalidateTag('posts');
        expect(await store.get('p1')).toBeNull();
        expect(await store.get('p2')).toBeNull();
        expect(await store.get('u1')).not.toBeNull();
    });

    it('does not duplicate a key in the tag index on re-set', async () => {
        await store.set('k', 1, { tags: ['t'] });
        await store.set('k', 2, { tags: ['t'] }); // key already in tag list
        await store.invalidateTag('t');
        expect(await store.get('k')).toBeNull();
    });

    it('prunes a key from the tag index when deleted directly (not via invalidateTag)', async () => {
        await store.set('k', 1, { tags: ['t'] });
        await store.delete('k');
        const index = JSON.parse(
            readFileSync(join(dir, '__tags.json'), 'utf-8'),
        );
        expect(index.t).toBeUndefined();
    });

    it('a failed tag-index write does not wedge later tag-index writes', async () => {
        // Force the first tag-index write to fail: a directory in place of
        // the expected __tags.json makes writeFile reject with EISDIR.
        mkdirSync(join(dir, '__tags.json'));
        await expect(store.set('k1', 1, { tags: ['t'] })).rejects.toThrow();
        rmSync(join(dir, '__tags.json'), { recursive: true, force: true });
        // A later tag-index write (different key) must still go through
        // rather than hang behind the failed one.
        await store.set('k2', 2, { tags: ['t'] });
        await store.invalidateTag('t');
        expect(await store.get('k2')).toBeNull();
    });

    it('tolerates a tag missing from the index when deleting an entry that references it (desync recovery)', async () => {
        await store.set('k', 1, { tags: ['t'] });
        // Simulate the tags index having lost this tag's entry (e.g. a prior
        // partial write) by removing it directly, out of band.
        const index = JSON.parse(
            readFileSync(join(dir, '__tags.json'), 'utf-8'),
        );
        delete index.t;
        writeFileSync(join(dir, '__tags.json'), JSON.stringify(index), 'utf-8');

        await expect(store.delete('k')).resolves.toBeUndefined();
    });

    it('is a no-op when invalidating an unknown tag', async () => {
        await expect(store.invalidateTag('none')).resolves.toBeUndefined();
    });

    it('contract: every key is hashed to a filename inside the store dir, closing path traversal', async () => {
        // Every key -- including one crafted to escape `dir` via `../`, one
        // with an embedded null byte, and a very long one -- is SHA-256-hashed
        // before use as a filename, so none of these can write outside `dir`
        // or produce a human-readable/collidable filename. This pins that
        // design as a contract so a future "human-readable cache filenames"
        // refactor can't silently reintroduce traversal.
        const adversarialKeys = [
            '../../../etc/passwd',
            '..\\..\\windows\\system32\\config',
            `null\0byte`,
            'a'.repeat(10_000),
        ];
        for (const key of adversarialKeys) {
            await store.set(key, `value for ${key}`);
        }

        const files = readdirSync(dir).filter((f) => f.endsWith('.cache'));
        expect(files).toHaveLength(adversarialKeys.length);
        for (const file of files) {
            // Filename is exactly `${64-char hex sha256}.cache` -- nothing
            // derived verbatim from the key, and no path separators.
            expect(file).toMatch(/^[0-9a-f]{64}\.cache$/);
        }

        for (const key of adversarialKeys) {
            expect((await store.get<string>(key))?.value).toBe(
                `value for ${key}`,
            );
        }
    });

    it('clears the directory and can be reused afterwards', async () => {
        await store.set('a', 1);
        await store.clear();
        expect(await store.get('a')).toBeNull();
        await store.set('b', 2); // ensureDir recreates the directory
        expect((await store.get<number>('b'))?.value).toBe(2);
    });
});
