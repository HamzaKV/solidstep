import { test, expect } from '@playwright/test';

// The soft-navigation data endpoint returns a seroval-serialized envelope. The
// exact serialization is an internal detail, so we assert on the discriminant
// + key identifiers present in the payload string.
test.describe('/__solidstep_route envelope', () => {
    test('returns a page envelope with the matched route + loader data', async ({
        request,
    }) => {
        const res = await request.get(
            `/__solidstep_route?url=${encodeURIComponent('/dashboard')}`,
        );
        expect(res.status()).toBe(200);
        const body = await res.text();
        expect(body).toContain('"page"');
        expect(body).toContain('/route/dashboard');
        // Dashboard's parallel-route group loader data is keyed by group path.
        expect(body).toContain('/group/dashboard');
    });

    test('returns a not-found envelope for an unmatched path', async ({
        request,
    }) => {
        const res = await request.get(
            `/__solidstep_route?url=${encodeURIComponent('/no/such/page')}`,
        );
        expect(res.status()).toBe(200);
        expect(await res.text()).toContain('"not-found"');
    });

    test('returns a route envelope for an API route', async ({ request }) => {
        const res = await request.get(
            `/__solidstep_route?url=${encodeURIComponent('/api/health')}`,
        );
        expect(res.status()).toBe(200);
        expect(await res.text()).toContain('"route"');
    });

    test('400s when the url param is missing', async ({ request }) => {
        const res = await request.get('/__solidstep_route');
        expect(res.status()).toBe(400);
    });
});
