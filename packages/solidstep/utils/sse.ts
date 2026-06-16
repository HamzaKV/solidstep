// utils/sse.ts
// Streaming-response helpers for `route.ts` API handlers: Server-Sent Events
// (`sseResponse`) and arbitrary chunked text/bytes (`streamResponse`). Both wrap
// an async generator in a web `ReadableStream` `Response`, so a handler can
// stream without hand-rolling the stream/encoder/headers.

/** A single Server-Sent Event. `data` may contain newlines (each line is framed). */
export type SSEMessage = {
    data: string;
    /** Optional event name (`event:` field). */
    event?: string;
    /** Optional event id (`id:` field). */
    id?: string;
    /** Optional reconnection time in ms (`retry:` field). */
    retry?: number;
};

/** Encode one {@link SSEMessage} into the `text/event-stream` wire format. */
export const encodeSSE = (message: SSEMessage): string => {
    let out = '';
    if (message.event) out += `event: ${message.event}\n`;
    if (message.id) out += `id: ${message.id}\n`;
    if (message.retry !== undefined) out += `retry: ${message.retry}\n`;
    // A `data:` line per physical line, so multi-line payloads stay valid.
    for (const line of message.data.split('\n')) {
        out += `data: ${line}\n`;
    }
    return `${out}\n`;
};

/**
 * Stream Server-Sent Events from a `route.ts` handler. Yield strings (shorthand
 * for `{ data }`) or {@link SSEMessage}s from the generator; the stream closes
 * when the generator completes.
 *
 * @example
 * ```ts
 * // app/events/route.ts
 * import { sseResponse } from 'solidstep/utils/sse';
 *
 * export function GET() {
 *   return sseResponse(async function* () {
 *     yield { event: 'tick', data: String(Date.now()) };
 *   });
 * }
 * ```
 */
export const sseResponse = (
    generator: () => AsyncIterable<SSEMessage | string>,
    init?: ResponseInit,
): Response => {
    const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
            const encoder = new TextEncoder();
            try {
                for await (const message of generator()) {
                    const msg =
                        typeof message === 'string'
                            ? { data: message }
                            : message;
                    controller.enqueue(encoder.encode(encodeSSE(msg)));
                }
            } finally {
                controller.close();
            }
        },
    });
    return new Response(stream, {
        ...init,
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            ...init?.headers,
        },
    });
};

/**
 * Stream an arbitrary text/byte body from a `route.ts` handler. Yield strings
 * (UTF-8 encoded) or `Uint8Array` chunks; the stream closes when the generator
 * completes. Set your own `Content-Type` via `init`.
 */
export const streamResponse = (
    generator: () => AsyncIterable<string | Uint8Array>,
    init?: ResponseInit,
): Response => {
    const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
            const encoder = new TextEncoder();
            try {
                for await (const chunk of generator()) {
                    controller.enqueue(
                        typeof chunk === 'string'
                            ? encoder.encode(chunk)
                            : chunk,
                    );
                }
            } finally {
                controller.close();
            }
        },
    });
    return new Response(stream, init);
};
