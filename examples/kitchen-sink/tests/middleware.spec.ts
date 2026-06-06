import { test, expect } from '@playwright/test';

test.describe('composable middleware (defineMiddleware)', () => {
    test('applies a per-request CSP nonce', async ({ request }) => {
        const res = await request.get('/');
        const nonce = res.headers()['x-csp-nonce'];
        expect(nonce).toBeTruthy();
        const csp = res.headers()['content-security-policy'];
        expect(csp).toContain(`'nonce-${nonce}'`);
    });

    test('CSP nonce differs between requests', async ({ request }) => {
        const a = (await request.get('/')).headers()['x-csp-nonce'];
        const b = (await request.get('/')).headers()['x-csp-nonce'];
        expect(a).toBeTruthy();
        expect(b).toBeTruthy();
        expect(a).not.toBe(b);
    });

    test('CSRF blocks cross-origin unsafe requests with 403', async ({
        request,
    }) => {
        const res = await request.post('/api/health', {
            headers: { origin: 'https://evil.example.com' },
            data: { x: 1 },
        });
        expect(res.status()).toBe(403);
    });

    test('CORS allows trusted origins', async ({ request }) => {
        const res = await request.get('/', {
            headers: { origin: 'https://trusted.example.com' },
        });
        expect(res.headers()['access-control-allow-origin']).toBe(
            'https://trusted.example.com',
        );
    });

    test('CORS does not echo untrusted origins', async ({ request }) => {
        const res = await request.get('/', {
            headers: { origin: 'https://untrusted.example.com' },
        });
        expect(res.headers()['access-control-allow-origin']).toBeUndefined();
    });
});
