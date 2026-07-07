import { test, expect } from '@playwright/test';

test.describe('hydration.disable (true zero-JS)', () => {
    test('renders the page content without a hydration or manifest script', async ({
        request,
    }) => {
        const res = await request.get('/hydration-disable');
        expect(res.status()).toBe(200);
        const html = await res.text();

        expect(html).toContain('Static, no hydration');
        // No client-manifest script, no framework hydration bootstrap script.
        expect(html).not.toContain('window.manifest');
        expect(html).not.toContain('import main');
        // No module-preload links for the route's own client bundle.
        expect(html).not.toContain('modulepreload');
    });

    test('<Link> falls back to a full page load (no client router present)', async ({
        page,
    }) => {
        await page.goto('/hydration-disable');
        await expect(page.getByTestId('heading')).toHaveText(
            'Static, no hydration',
        );

        const navigation = page.waitForEvent('framenavigated');
        await page.getByTestId('home-link').click();
        await navigation;

        await expect(page).toHaveURL(/\/$/);
    });
});
