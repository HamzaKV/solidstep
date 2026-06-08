import { test, expect } from '@playwright/test';

test.describe('loading, error, and not-found boundaries', () => {
    test('slow route streams the loading boundary then the content', async ({
        page,
        request,
    }) => {
        // The loading.tsx markup is flushed first while the loader resolves.
        const res = await request.get('/slow');
        expect(res.status()).toBe(200);
        expect(await res.text()).toContain('Loading slow page');

        // The streamed page eventually swaps in the real content.
        await page.goto('/slow');
        await expect(page.getByTestId('slow-content')).toHaveText(
            'loaded: true',
        );
    });

    test('error boundary renders error.tsx with the thrown message', async ({
        page,
        request,
    }) => {
        const res = await request.get('/boom');
        expect(res.status()).toBe(500);

        await page.goto('/boom');
        await expect(page.getByTestId('error-message')).toHaveText(
            'kaboom from the loader',
        );
    });

    test('unknown route returns 404 and renders the custom not-found page', async ({
        page,
        request,
    }) => {
        const res = await request.get('/this-route-does-not-exist');
        expect(res.status()).toBe(404);

        await page.goto('/this-route-does-not-exist');
        await expect(page.getByTestId('not-found')).toHaveText(
            'This page could not be found.',
        );
    });
});
