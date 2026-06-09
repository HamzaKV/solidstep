import { test, expect } from '@playwright/test';

test.describe('deferred loaders', () => {
    test('resolves and shows the deferred content after streaming', async ({
        page,
    }) => {
        await page.goto('/deferred');
        await expect(page.getByTestId('deferred-content')).toHaveText(
            'deferred-content-loaded',
        );
    });

    test('streams the loading fallback in the shell before the content', async ({
        request,
    }) => {
        const res = await request.get('/deferred');
        expect(res.status()).toBe(200);
        const html = await res.text();
        expect(html).toContain('deferred-content-loaded');
        // The loading fallback is emitted in the initial shell, ahead of the
        // streamed-in resolved content.
        expect(html.indexOf('deferred-loading')).toBeLessThan(
            html.indexOf('deferred-content-loaded'),
        );
    });
});
