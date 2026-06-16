import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isSafeRedirectTarget } from '../utils/redirect';

// `redirect`/`safeRedirect` branch on `isServer` from 'solid-js/web'; each block
// remocks it and re-imports so both the server (throw) and client (navigate)
// paths are covered.

const expectRedirectTo = (fn: () => void, target: string) => {
    try {
        fn();
        throw new Error('expected a RedirectError to be thrown');
    } catch (e) {
        expect((e as Error).name).toBe('RedirectError');
        expect((e as Error).message).toBe(target);
    }
};

describe('redirect (server)', () => {
    beforeEach(() => vi.resetModules());

    it('throws a RedirectError carrying the target url', async () => {
        vi.doMock('solid-js/web', () => ({ isServer: true }));
        const { redirect } = await import('../utils/redirect');
        expectRedirectTo(() => redirect('/login'), '/login');
    });
});

describe('redirect (client)', () => {
    beforeEach(() => vi.resetModules());

    it('navigates via window.location on the client', async () => {
        vi.doMock('solid-js/web', () => ({ isServer: false }));
        const { redirect } = await import('../utils/redirect');
        // biome-ignore lint/suspicious/noExplicitAny: minimal window stub.
        (globalThis as any).window = { location: { href: '' } };
        redirect('/dashboard');
        // biome-ignore lint/suspicious/noExplicitAny: minimal window stub.
        expect((globalThis as any).window.location.href).toBe('/dashboard');
        // biome-ignore lint/suspicious/noExplicitAny: cleanup.
        (globalThis as any).window = undefined;
    });
});

describe('safeRedirect (server)', () => {
    beforeEach(() => vi.resetModules());

    it('redirects to the url when safe and to the fallback when unsafe', async () => {
        vi.doMock('solid-js/web', () => ({ isServer: true }));
        const { safeRedirect } = await import('../utils/redirect');
        expectRedirectTo(() => safeRedirect('/ok'), '/ok');
        expectRedirectTo(() => safeRedirect('//evil.com'), '/');
        expectRedirectTo(
            () => safeRedirect('//evil.com', { fallback: '/login' }),
            '/login',
        );
        expectRedirectTo(
            () =>
                safeRedirect('https://auth.example.com/x', {
                    allowedHosts: ['auth.example.com'],
                }),
            'https://auth.example.com/x',
        );
    });
});

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
