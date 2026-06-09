import { test, expect } from '@playwright/test';

test.describe('loader caching', () => {
    test('a cached loader is not re-run on repeat requests', async ({
        request,
    }) => {
        const first = await request.get('/cached');
        const second = await request.get('/cached');
        expect(first.status()).toBe(200);
        expect(second.status()).toBe(200);

        // Strip Solid's hydration comment markers (e.g. `value:<!--$-->1`) so the
        // static text and the dynamic value read as one string.
        const readValue = (html: string) =>
            html.replace(/<!--[^>]*-->/g, '').match(/value:(\d+)/)?.[1] ?? null;

        const v1 = readValue(await first.text());
        const v2 = readValue(await second.text());
        expect(v1).not.toBeNull();
        // Same value across requests → the loader ran once and was cached.
        expect(v2).toBe(v1);
    });
});
