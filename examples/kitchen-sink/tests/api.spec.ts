import { test, expect } from '@playwright/test';

test.describe('API routes (route.ts)', () => {
    test('GET /api/health returns JSON', async ({ request }) => {
        const res = await request.get('/api/health');
        expect(res.status()).toBe(200);
        expect(res.headers()['content-type']).toContain('application/json');
        expect(await res.json()).toEqual({ status: 'ok', service: 'kitchen-sink' });
    });

    test('POST /api/health echoes the request body', async ({ request }) => {
        // No cross-origin header → CSRF allows it (same-origin / non-HTTPS).
        const res = await request.post('/api/health', {
            data: { hello: 'world' },
        });
        expect(res.status()).toBe(200);
        expect(await res.json()).toEqual({ received: { hello: 'world' } });
    });
});
