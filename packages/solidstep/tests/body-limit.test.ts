import { describe, it, expect } from 'vitest';
import {
    parseContentLength,
    isOverBodyLimit,
    bodyLimit,
} from '../utils/body-limit';

describe('parseContentLength', () => {
    it('returns null for missing/empty values', () => {
        expect(parseContentLength(undefined)).toBeNull();
        expect(parseContentLength(null)).toBeNull();
        expect(parseContentLength('')).toBeNull();
    });

    it('parses a valid non-negative integer', () => {
        expect(parseContentLength('100')).toBe(100);
        expect(parseContentLength('0')).toBe(0);
    });

    it('returns NaN (present but unusable) for non-numeric or negative values, not null (unknown)', () => {
        // A header that IS present but doesn't parse cleanly (garbage, a
        // negative number, or -- critically -- a comma-joined duplicate like
        // "10, 999999999", a classic request-smuggling technique) must be
        // distinguishable from a genuinely absent header: the former should
        // fail closed (reject), the latter is allowed through (chunked
        // transfer has no Content-Length at all).
        expect(parseContentLength('abc')).toBeNaN();
        expect(parseContentLength('-5')).toBeNaN();
        expect(parseContentLength('10, 999999999')).toBeNaN();
    });
});

describe('isOverBodyLimit', () => {
    it('is false when the length is unknown (header absent)', () => {
        expect(isOverBodyLimit(null, 10)).toBe(false);
    });
    it('is true when the header is present but malformed/ambiguous', () => {
        expect(isOverBodyLimit(Number.NaN, 10)).toBe(true);
    });
    it('is true when over the limit', () => {
        expect(isOverBodyLimit(11, 10)).toBe(true);
    });
    it('is false when within the limit', () => {
        expect(isOverBodyLimit(10, 10)).toBe(false);
    });
});

describe('bodyLimit middleware', () => {
    const event = (contentLength?: string) =>
        ({
            node: {
                req: {
                    headers:
                        contentLength === undefined
                            ? {}
                            : { 'content-length': contentLength },
                },
            },
            // biome-ignore lint/suspicious/noExplicitAny: minimal fake H3 event.
        }) as any;

    it('rejects an oversized body with 413', async () => {
        const res = await bodyLimit({ maxBytes: 10 }).onRequest?.(event('20'));
        expect(res).toBeInstanceOf(Response);
        expect((res as Response).status).toBe(413);
    });

    it('allows a within-limit body', async () => {
        expect(
            await bodyLimit({ maxBytes: 10 }).onRequest?.(event('5')),
        ).toBeUndefined();
    });

    it('allows a request with no Content-Length', async () => {
        expect(
            await bodyLimit({ maxBytes: 10 }).onRequest?.(event()),
        ).toBeUndefined();
    });

    it('rejects a duplicate/comma-joined Content-Length instead of treating it as unknown', async () => {
        const res = await bodyLimit({ maxBytes: 10 }).onRequest?.(
            event('10, 999999999'),
        );
        expect(res).toBeInstanceOf(Response);
        expect((res as Response).status).toBe(413);
    });
});
