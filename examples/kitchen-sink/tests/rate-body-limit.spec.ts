import { test, expect } from '@playwright/test';

// bodyLimit/rateLimit are scoped to /api/limits-test only in app/middleware.ts
// (a fixed rate-limit key, not per-IP) so these don't affect any other spec's
// traffic against the shared server instance.
test.describe('bodyLimit + rateLimit middleware', () => {
    test('an oversized body gets a 413', async ({ request }) => {
        const res = await request.post('/api/limits-test', {
            headers: { 'content-type': 'text/plain' },
            data: 'x'.repeat(200), // over the 100-byte maxBytes
        });
        expect(res.status()).toBe(413);
    });

    test('a burst past max gets a 429 with Retry-After', async ({
        request,
    }) => {
        let last: Awaited<ReturnType<typeof request.post>> | undefined;
        for (let i = 0; i < 5; i++) {
            last = await request.post('/api/limits-test', { data: 'ok' });
        }
        expect(last!.status()).toBe(429);
        expect(last!.headers()['retry-after']).toBeTruthy();
    });
});
