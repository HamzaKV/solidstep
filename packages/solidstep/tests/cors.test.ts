import { describe, it, expect } from 'vitest';
import { cors } from '../utils/cors';

const trustedOrigins = ['https://example.com', 'https://app.example.com'];
const check = cors(trustedOrigins);

describe('untrusted origin', () => {
    it('returns empty object for an untrusted origin', () => {
        expect(check('https://evil.com', false)).toEqual({});
    });

    it('returns empty object for an untrusted origin on preflight', () => {
        expect(check('https://evil.com', true)).toEqual({});
    });
});

describe('trusted origin — normal request', () => {
    it('returns Allow-Origin header only', () => {
        const headers = check('https://example.com', false);
        expect(headers).toEqual({
            'Access-Control-Allow-Origin': 'https://example.com',
        });
    });

    it('echoes back the exact trusted origin', () => {
        const headers = check('https://app.example.com', false);
        expect(headers['Access-Control-Allow-Origin']).toBe(
            'https://app.example.com',
        );
    });
});

describe('trusted origin — preflight request', () => {
    it('returns Allow-Origin, Allow-Methods, and Allow-Headers', () => {
        const headers = check('https://example.com', true);
        expect(headers['Access-Control-Allow-Origin']).toBe(
            'https://example.com',
        );
        expect(headers['Access-Control-Allow-Methods']).toBeDefined();
        expect(headers['Access-Control-Allow-Headers']).toBeDefined();
    });

    it('default allowed methods include GET, POST, PUT, PATCH, DELETE, OPTIONS', () => {
        const headers = check('https://example.com', true) as Record<
            string,
            string
        >;
        const methods = headers['Access-Control-Allow-Methods'].split(', ');
        expect(methods).toContain('GET');
        expect(methods).toContain('POST');
        expect(methods).toContain('PUT');
        expect(methods).toContain('PATCH');
        expect(methods).toContain('DELETE');
        expect(methods).toContain('OPTIONS');
    });

    it('default allowed headers include Content-Type and Authorization', () => {
        const headers = check('https://example.com', true) as Record<
            string,
            string
        >;
        const allowed = headers['Access-Control-Allow-Headers'].split(', ');
        expect(allowed).toContain('Content-Type');
        expect(allowed).toContain('Authorization');
    });
});

describe('custom methods and headers', () => {
    it('uses provided allowMethods', () => {
        const customCheck = cors(trustedOrigins, ['GET', 'POST']);
        const headers = customCheck('https://example.com', true) as Record<
            string,
            string
        >;
        const methods = headers['Access-Control-Allow-Methods'].split(', ');
        expect(methods).toEqual(['GET', 'POST']);
    });

    it('uses provided allowHeaders', () => {
        const customCheck = cors(trustedOrigins, undefined, [
            'X-Custom-Header',
        ]);
        const headers = customCheck('https://example.com', true) as Record<
            string,
            string
        >;
        expect(headers['Access-Control-Allow-Headers']).toBe('X-Custom-Header');
    });
});

describe('trustedOrigins case normalization', () => {
    // An uppercase character anywhere in a configured trustedOrigins entry
    // would otherwise silently and permanently fail to match the browser's
    // (always-lowercase-host) Origin header -- a production misconfiguration
    // trap, not exploitable, but a real footgun.
    const mixedCaseCheck = cors(['https://Example.com']);

    it('matches a trusted origin despite mixed-case configuration', () => {
        const headers = mixedCaseCheck('https://example.com', false) as Record<
            string,
            string
        >;
        expect(headers['Access-Control-Allow-Origin']).toBe(
            'https://example.com',
        );
    });
});

describe('credentialed CORS', () => {
    const credCheck = cors(trustedOrigins, undefined, undefined, {
        allowCredentials: true,
    });

    it('adds Allow-Credentials on a simple (non-preflight) response', () => {
        const headers = credCheck('https://example.com', false) as Record<
            string,
            string
        >;
        expect(headers['Access-Control-Allow-Credentials']).toBe('true');
        expect(headers['Access-Control-Allow-Origin']).toBe(
            'https://example.com',
        );
    });

    it('adds Allow-Credentials on a preflight response', () => {
        const headers = credCheck('https://example.com', true) as Record<
            string,
            string
        >;
        expect(headers['Access-Control-Allow-Credentials']).toBe('true');
    });

    it('never emits credential headers for an untrusted origin', () => {
        expect(credCheck('https://evil.com', true)).toEqual({});
    });

    it('omits Allow-Credentials when not enabled (default)', () => {
        const headers = check('https://example.com', false) as Record<
            string,
            string
        >;
        expect(headers['Access-Control-Allow-Credentials']).toBeUndefined();
    });
});
