// utils/body-limit.ts
// A request body-size guard middleware. It rejects based on the declared
// `Content-Length`, which is the cheap, allocation-free check; a chunked request
// with no Content-Length is not caught here (the runtime/proxy should bound those
// — see the docs), so treat this as a first line of defence, not a hard cap.

import type { Middleware } from './middleware.js';
import type { H3Event } from 'vinxi/http';

/** Parse a `Content-Length` header value into a non-negative integer, or null. */
export const parseContentLength = (
    header: string | null | undefined,
): number | null => {
    if (!header) return null;
    const n = Number(header);
    return Number.isFinite(n) && n >= 0 ? n : null;
};

/** Whether a known content length exceeds `maxBytes` (unknown length → false). */
export const isOverBodyLimit = (
    contentLength: number | null,
    maxBytes: number,
): boolean => contentLength !== null && contentLength > maxBytes;

/**
 * A {@link Middleware} that rejects with `413 Payload Too Large` when the
 * request's declared `Content-Length` exceeds `maxBytes`.
 *
 * @example
 * ```ts
 * // app/middleware.ts
 * import { defineMiddleware } from 'solidstep/utils/middleware';
 * import { bodyLimit } from 'solidstep/utils/body-limit';
 *
 * export default defineMiddleware([
 *   bodyLimit({ maxBytes: 1_000_000 }), // 1 MB
 * ]);
 * ```
 */
export const bodyLimit = (options: {
    maxBytes: number;
    message?: string;
}): Middleware => {
    const { maxBytes, message = 'Payload Too Large' } = options;
    return {
        onRequest: (event: H3Event) => {
            // biome-ignore lint/suspicious/noExplicitAny: H3Event's node shape is wider than its published type.
            const header = (event as any).node?.req?.headers?.[
                'content-length'
            ];
            const len = parseContentLength(
                typeof header === 'string' ? header : null,
            );
            if (isOverBodyLimit(len, maxBytes)) {
                return new Response(message, {
                    status: 413,
                    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
                });
            }
        },
    };
};
