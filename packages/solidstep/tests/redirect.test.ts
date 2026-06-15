import { describe, it, expect } from 'vitest';
import { isSafeRedirectTarget } from '../utils/redirect';

describe('isSafeRedirectTarget', () => {
    it('accepts same-site relative paths', () => {
        expect(isSafeRedirectTarget('/')).toBe(true);
        expect(isSafeRedirectTarget('/dashboard')).toBe(true);
        expect(isSafeRedirectTarget('/a/b?c=d#e')).toBe(true);
    });

    it('rejects protocol-relative and backslash URLs', () => {
        expect(isSafeRedirectTarget('//evil.com')).toBe(false);
        expect(isSafeRedirectTarget('/\\evil.com')).toBe(false);
        expect(isSafeRedirectTarget('\\\\evil.com')).toBe(false);
    });

    it('rejects absolute URLs whose host is not allowlisted', () => {
        expect(isSafeRedirectTarget('https://evil.com')).toBe(false);
        expect(
            isSafeRedirectTarget('https://evil.com', ['auth.example.com']),
        ).toBe(false);
    });

    it('accepts absolute URLs whose host is allowlisted', () => {
        expect(
            isSafeRedirectTarget('https://auth.example.com/login', [
                'auth.example.com',
            ]),
        ).toBe(true);
    });

    it('rejects dangerous schemes', () => {
        expect(isSafeRedirectTarget('javascript:alert(1)')).toBe(false);
        expect(isSafeRedirectTarget('data:text/html,<script>1</script>')).toBe(
            false,
        );
    });

    it('rejects empty / malformed input', () => {
        expect(isSafeRedirectTarget('')).toBe(false);
        expect(isSafeRedirectTarget('not a url')).toBe(false);
    });
});
