import { test, expect } from '@playwright/test';

const ENDPOINT = '/__solidstep_revalidate';
const TOKEN = 'e2e-test-revalidate-token';

test.describe('on-demand revalidation endpoint', () => {
    test('GET is rejected with 405', async ({ request }) => {
        const res = await request.get(ENDPOINT);
        expect(res.status()).toBe(405);
    });

    test('POST with no token is rejected with 401', async ({ request }) => {
        const res = await request.post(ENDPOINT, { data: { path: '/' } });
        expect(res.status()).toBe(401);
    });

    test('POST with the wrong token is rejected with 401', async ({
        request,
    }) => {
        const res = await request.post(ENDPOINT, {
            headers: { authorization: 'Bearer wrong-token' },
            data: { path: '/' },
        });
        expect(res.status()).toBe(401);
    });

    test('POST with the correct token and { path } revalidates', async ({
        request,
    }) => {
        const res = await request.post(ENDPOINT, {
            headers: { authorization: `Bearer ${TOKEN}` },
            data: { path: '/cache-tags' },
        });
        expect(res.status()).toBe(200);
        const body = await res.json();
        expect(body).toEqual({ revalidated: true, path: '/cache-tags' });
    });

    test('POST with the correct token and { tag } revalidates', async ({
        request,
    }) => {
        const res = await request.post(ENDPOINT, {
            headers: { authorization: `Bearer ${TOKEN}` },
            data: { tag: 'products' },
        });
        expect(res.status()).toBe(200);
        const body = await res.json();
        expect(body).toEqual({ revalidated: true, tag: 'products' });
    });

    test('POST with neither path nor tag is rejected with 400', async ({
        request,
    }) => {
        const res = await request.post(ENDPOINT, {
            headers: { authorization: `Bearer ${TOKEN}` },
            data: {},
        });
        expect(res.status()).toBe(400);
    });
});
