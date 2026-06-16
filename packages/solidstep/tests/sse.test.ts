import { describe, it, expect } from 'vitest';
import { encodeSSE, sseResponse, streamResponse } from '../utils/sse';

describe('encodeSSE', () => {
    it('frames a bare data message', () => {
        expect(encodeSSE({ data: 'hello' })).toBe('data: hello\n\n');
    });

    it('includes event, id, and retry fields when present', () => {
        expect(encodeSSE({ data: 'x', event: 'tick', id: '1', retry: 0 })).toBe(
            'event: tick\nid: 1\nretry: 0\ndata: x\n\n',
        );
    });

    it('frames each line of a multi-line payload', () => {
        expect(encodeSSE({ data: 'a\nb' })).toBe('data: a\ndata: b\n\n');
    });
});

describe('sseResponse', () => {
    it('streams events with SSE headers (string shorthand + object)', async () => {
        const res = sseResponse(async function* () {
            yield 'one';
            yield { event: 'two', data: 'payload' };
        });
        expect(res.headers.get('Content-Type')).toBe('text/event-stream');
        expect(res.headers.get('Cache-Control')).toBe('no-cache, no-transform');
        const body = await res.text();
        expect(body).toBe('data: one\n\nevent: two\ndata: payload\n\n');
    });

    it('merges caller init and headers', async () => {
        const res = sseResponse(
            async function* () {
                yield 'x';
            },
            { status: 201, headers: { 'X-Custom': 'y' } },
        );
        expect(res.status).toBe(201);
        expect(res.headers.get('X-Custom')).toBe('y');
        expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    });
});

describe('streamResponse', () => {
    it('streams string and Uint8Array chunks', async () => {
        const res = streamResponse(async function* () {
            yield 'a';
            yield new TextEncoder().encode('b');
        });
        expect(await res.text()).toBe('ab');
    });

    it('applies caller init', async () => {
        const res = streamResponse(
            async function* () {
                yield 'hi';
            },
            { headers: { 'Content-Type': 'text/plain' } },
        );
        expect(res.headers.get('Content-Type')).toBe('text/plain');
        expect(await res.text()).toBe('hi');
    });
});
