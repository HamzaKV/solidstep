import { describe, it, expect } from 'vitest';
import { csrf } from '../utils/csrf';

const trustedOrigins = ['trusted.example.com'];
const check = csrf(trustedOrigins);

const httpUrl = new URL('http://myapp.com/api/data');
const httpsUrl = new URL('https://myapp.com/api/data');

describe('safe methods always pass', () => {
    for (const method of ['GET', 'OPTIONS', 'HEAD', 'TRACE']) {
        it(`${method} passes with no origin or referer`, () => {
            expect(check(method, httpsUrl).success).toBe(true);
        });
    }
});

describe('unsafe methods — origin check', () => {
    it('passes when origin matches the request origin', () => {
        const result = check('POST', httpsUrl, 'https://myapp.com');
        expect(result.success).toBe(true);
    });

    it('passes when origin is in the trusted origins list', () => {
        const result = check('POST', httpsUrl, 'https://trusted.example.com');
        expect(result.success).toBe(true);
    });

    it('fails when origin does not match and is not trusted', () => {
        const result = check('POST', httpsUrl, 'https://evil.com');
        expect(result.success).toBe(false);
        expect(result.message).toBe('Invalid origin');
    });

    it('applies to PUT, DELETE, PATCH as well', () => {
        for (const method of ['PUT', 'DELETE', 'PATCH']) {
            expect(check(method, httpsUrl, 'https://evil.com').success).toBe(false);
        }
    });
});

describe('unsafe methods — referer check (HTTPS, no origin)', () => {
    it('fails when no referer is supplied over HTTPS', () => {
        const result = check('POST', httpsUrl, undefined, undefined);
        expect(result.success).toBe(false);
        expect(result.message).toBe('referer not supplied');
    });

    it('fails when referer uses HTTP (not HTTPS)', () => {
        const result = check('POST', httpsUrl, undefined, 'http://myapp.com/form');
        expect(result.success).toBe(false);
        expect(result.message).toBe('Invalid referer');
    });

    it('passes when referer host matches request host', () => {
        const result = check('POST', httpsUrl, undefined, 'https://myapp.com/form');
        expect(result.success).toBe(true);
    });

    it('passes when referer host is in trusted origins', () => {
        const result = check('POST', httpsUrl, undefined, 'https://trusted.example.com/form');
        expect(result.success).toBe(true);
    });

    it('fails when referer host does not match and is not trusted', () => {
        const result = check('POST', httpsUrl, undefined, 'https://attacker.com/form');
        expect(result.success).toBe(false);
        expect(result.message).toBe('Invalid referer');
    });
});

describe('HTTP requests — no referer check required', () => {
    it('passes POST over HTTP with no origin and no referer', () => {
        const result = check('POST', httpUrl, undefined, undefined);
        expect(result.success).toBe(true);
    });
});

describe('custom safe methods', () => {
    it('respects a custom safe methods list', () => {
        const strictCheck = csrf([], ['GET']);
        expect(strictCheck('OPTIONS', httpsUrl, 'https://evil.com').success).toBe(false);
        expect(strictCheck('GET', httpsUrl).success).toBe(true);
    });
});
