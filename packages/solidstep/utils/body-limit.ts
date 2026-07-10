// utils/body-limit.ts
// A request body-size guard middleware. It rejects based on the declared
// `Content-Length`, which is the cheap, allocation-free check; a chunked request
// with no Content-Length is not caught here (the runtime/proxy should bound those
// — see the docs), so treat this as a first line of defence, not a hard cap.

import type { Middleware } from './middleware.js';
import type { H3Event } from 'vinxi/http';

/**
 * Parse a `Content-Length` header value.
 *
 * - `null` — the header is genuinely absent (e.g. a chunked-transfer
 *   request), which isn't a red flag on its own.
 * - `NaN` — the header is *present* but doesn't parse cleanly (garbage, a
 *   negative number, or a comma-joined duplicate value like
 *   `"10, 999999999"` — a classic request-smuggling technique). Distinct
 *   from `null` so callers can fail closed on it instead of treating it the
 *   same as "unknown."
 * - otherwise the parsed non-negative integer.
 */
export const parseContentLength = (
    header: string | null | undefined,
): number | null => {
    if (!header) return null;
    // RFC 9110 §8.6: Content-Length is 1*DIGIT — reject hex/scientific/signed
    // forms Number() would accept ('0x10', '1e6', '+5'); lenient parsers on
    // either side of a proxy are exactly what smuggling exploits.
    if (!/^\d+$/.test(header)) return Number.NaN;
    const n = Number(header);
    return Number.isFinite(n) && n >= 0 ? n : Number.NaN;
};

/**
 * Whether a body should be rejected: over `maxBytes`, or the length is
 * present but malformed/ambiguous (fail closed). A genuinely unknown length
 * (`null` — header absent) is not itself rejected.
 */
export const isOverBodyLimit = (
    contentLength: number | null,
    maxBytes: number,
): boolean =>
    contentLength !== null &&
    (Number.isNaN(contentLength) || contentLength > maxBytes);

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
