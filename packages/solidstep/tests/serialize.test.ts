// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { serialize, deserialize } from 'seroval';
import {
    SEROVAL_PLUGINS,
    SerovalChunkReader,
    createChunk,
    serializeToStream,
} from '../utils/serialize';

// Unique cross-reference scope id per round-trip so the global `$R` registry
// populated by `deserialize` doesn't leak between cases.
let scope = 0;
const nextId = () => `test-scope-${scope++}`;

/** Drain a chunk stream and return the first (initial) deserialized value. */
async function roundTrip<T>(value: T): Promise<any> {
    const stream = serializeToStream(nextId(), value);
    const reader = new SerovalChunkReader(stream);
    const first = await reader.next();
    await reader.drain();
    return first.value;
}

/** Collect every byte emitted by a stream into a single Uint8Array. */
async function collectBytes(stream: ReadableStream<Uint8Array>) {
    const reader = stream.getReader();
    const parts: Uint8Array[] = [];
    let total = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        total += value.length;
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
}

/** A ReadableStream that emits the given byte slices in order. */
function streamOf(...slices: Uint8Array[]) {
    return new ReadableStream<Uint8Array>({
        start(controller) {
            for (const slice of slices) controller.enqueue(slice);
            controller.close();
        },
    });
}

describe('SEROVAL_PLUGINS', () => {
    it('is the shared, non-empty plugin set', () => {
        expect(Array.isArray(SEROVAL_PLUGINS)).toBe(true);
        expect(SEROVAL_PLUGINS.length).toBe(10);
    });
});

describe('createChunk', () => {
    it('frames a payload with a 12-byte length header', () => {
        const chunk = createChunk('hello');
        // 12-byte header + 5 payload bytes
        expect(chunk.length).toBe(17);
        const header = new TextDecoder().decode(chunk.subarray(0, 12));
        expect(header).toBe(';0x00000005;');
        const payload = new TextDecoder().decode(chunk.subarray(12));
        expect(payload).toBe('hello');
    });

    it('encodes the byte length (not the character length) of multibyte data', () => {
        // '€' is 3 UTF-8 bytes.
        const chunk = createChunk('€');
        const header = new TextDecoder().decode(chunk.subarray(0, 12));
        expect(header).toBe(';0x00000003;');
    });

    it('produces independent buffers across calls (shared encoder is stateless)', () => {
        const a = createChunk('first');
        const b = createChunk('second');
        expect(new TextDecoder().decode(a.subarray(12))).toBe('first');
        expect(new TextDecoder().decode(b.subarray(12))).toBe('second');
    });
});

describe('serializeToStream <-> SerovalChunkReader round-trip', () => {
    it('round-trips a plain object', async () => {
        expect(await roundTrip({ a: 1, b: 'two', c: true })).toEqual({
            a: 1,
            b: 'two',
            c: true,
        });
    });

    it('round-trips a Date (preserving the type)', async () => {
        const date = new Date('2026-06-07T00:00:00.000Z');
        const result = await roundTrip(date);
        expect(result).toBeInstanceOf(Date);
        expect(result.getTime()).toBe(date.getTime());
    });

    it('round-trips nested structures with arrays', async () => {
        const value = { list: [1, 2, { nested: ['x', 'y'] }], n: null };
        expect(await roundTrip(value)).toEqual(value);
    });

    it('round-trips FormData via the FormDataPlugin', async () => {
        const fd = new FormData();
        fd.append('name', 'ada');
        fd.append('role', 'admin');
        const result = await roundTrip(fd);
        expect(result).toBeInstanceOf(FormData);
        expect(result.get('name')).toBe('ada');
        expect(result.get('role')).toBe('admin');
    });

    it('streams a value containing a Promise across follow-up chunks', async () => {
        // A pending Promise forces seroval to emit a non-initial follow-up chunk
        // once it resolves, exercising the streaming path.
        const stream = serializeToStream(nextId(), { p: Promise.resolve(42) });
        const reader = new SerovalChunkReader(stream);
        const first = await reader.next();
        await reader.drain();
        await expect(first.value.p).resolves.toBe(42);
    });
});

describe('envelope serialize/deserialize plugin asymmetry (server/data-endpoints.ts <-> client router-context.ts)', () => {
    // The server serializes route envelopes with `serialize(value, { plugins:
    // SEROVAL_PLUGINS })` (server/data-endpoints.ts), but the client
    // deserializes the response with plain `deserialize(text)` — no plugins
    // (utils/router-context.ts's fetchEnvelope, client.ts's fetchHole). This
    // is NOT a bug: in seroval's string-mode output, each plugin's
    // `serialize()` emits a self-contained JS expression (e.g. `new
    // URL("...")`, `new Headers({...})`) that needs no plugin registry to
    // evaluate back. Plugins are only required on the decode side for the
    // separate `fromJSON`/`toJSONAsync` node-tree codec, which envelopes
    // don't use. This test locks that asymmetry so it isn't "fixed" later
    // under the mistaken belief the client is missing something.
    it('round-trips URL/Headers/URLSearchParams/Date/Map through a plugin-less deserialize', () => {
        const value = {
            url: new URL('https://example.com/p?q=1'),
            headers: new Headers({ 'x-test': 'value' }),
            search: new URLSearchParams('a=1&b=2'),
            when: new Date('2026-01-01T00:00:00.000Z'),
            tags: new Map([['k', 'v']]),
        };

        const text = serialize(value, { plugins: SEROVAL_PLUGINS });
        const result = deserialize(text) as typeof value;

        expect(result.url).toBeInstanceOf(URL);
        expect(result.url.href).toBe(value.url.href);
        expect(result.headers).toBeInstanceOf(Headers);
        expect(result.headers.get('x-test')).toBe('value');
        expect(result.search).toBeInstanceOf(URLSearchParams);
        expect(result.search.get('a')).toBe('1');
        expect(result.when).toBeInstanceOf(Date);
        expect(result.when.getTime()).toBe(value.when.getTime());
        expect(result.tags).toBeInstanceOf(Map);
        expect(result.tags.get('k')).toBe('v');
    });
});

describe('SerovalChunkReader framing', () => {
    it('reassembles a frame split across multiple stream reads', async () => {
        const value = { hello: 'world', items: [1, 2, 3] };
        const bytes = await collectBytes(serializeToStream(nextId(), value));
        // Split mid-frame (inside the payload, after the 12-byte header).
        const mid = 12 + Math.floor((bytes.length - 12) / 2);
        const reader = new SerovalChunkReader(
            streamOf(bytes.subarray(0, mid), bytes.subarray(mid)),
        );
        const first = await reader.next();
        await reader.drain();
        expect(first.value).toEqual(value);
    });

    it('reassembles a frame whose 12-byte header itself is split across reads', async () => {
        const value = { hello: 'world', items: [1, 2, 3] };
        const bytes = await collectBytes(serializeToStream(nextId(), value));
        // Split inside the 12-byte header (bytes 0-11), not the payload.
        const reader = new SerovalChunkReader(
            streamOf(bytes.subarray(0, 5), bytes.subarray(5)),
        );
        const first = await reader.next();
        await reader.drain();
        expect(first.value).toEqual(value);
    });

    it('throws when the stream ends mid-header (fewer than 12 bytes ever arrive)', async () => {
        const truncated = new TextEncoder().encode(';0x00');
        const reader = new SerovalChunkReader(streamOf(truncated));
        await expect(reader.next()).rejects.toThrow(/truncated header/);
    });

    it('reports done on an empty stream', async () => {
        const reader = new SerovalChunkReader(streamOf());
        expect(await reader.next()).toEqual({ done: true, value: undefined });
    });

    it('throws on a malformed (non-hex) length header', async () => {
        const malformed = new TextEncoder().encode(';XXXXXXXXXX;payload');
        const reader = new SerovalChunkReader(streamOf(malformed));
        await expect(reader.next()).rejects.toThrow(/Malformed/);
    });

    it('throws when the stream ends before a full frame arrives', async () => {
        const bytes = await collectBytes(
            serializeToStream(nextId(), { a: 'long-enough-value' }),
        );
        // Drop the last byte so the declared length can never be satisfied.
        const reader = new SerovalChunkReader(
            streamOf(bytes.subarray(0, bytes.length - 1)),
        );
        await expect(reader.next()).rejects.toThrow(/Malformed/);
    });
});
