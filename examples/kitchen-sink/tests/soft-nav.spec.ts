import { test, expect } from '@playwright/test';

// Client-side (soft) navigation via <Link>: the document is not reloaded, the
// page content + URL + <title> update, loader data is fetched for the target
// route, and history (back/forward) works.
test.describe('soft navigation', () => {
    test('<Link> navigates without a full document reload', async ({
        page,
    }) => {
        await page.goto('/');
        await expect(page.getByTestId('heading')).toHaveText('Kitchen Sink');

        // Mark the live document; a full reload would wipe this.
        await page.evaluate(() => {
            (window as Window & { __noReload?: boolean }).__noReload = true;
        });
        let reloaded = false;
        page.on('load', () => {
            reloaded = true;
        });

        await page.getByRole('link', { name: 'About' }).click();

        await expect(page.getByTestId('heading')).toHaveText('About');
        await expect(page).toHaveURL(/\/about$/);
        await expect(page).toHaveTitle('About — Kitchen Sink');
        expect(
            await page.evaluate(
                () => (window as Window & { __noReload?: boolean }).__noReload,
            ),
        ).toBe(true);
        expect(reloaded).toBe(false);
    });

    test('soft navigation fetches the target route loader data', async ({
        page,
    }) => {
        await page.goto('/');
        await page.getByRole('link', { name: 'Dashboard' }).click();
        await expect(page.getByTestId('dashboard-page')).toBeVisible();
        // Parallel-route slots still render after a soft nav.
        await expect(page).toHaveURL(/\/dashboard$/);
    });

    test('back and forward restore the previous routes', async ({ page }) => {
        await page.goto('/');
        await page.getByRole('link', { name: 'About' }).click();
        await expect(page.getByTestId('heading')).toHaveText('About');

        await page.goBack();
        await expect(page.getByTestId('heading')).toHaveText('Kitchen Sink');
        await expect(page).toHaveURL(/\/$/);

        await page.goForward();
        await expect(page.getByTestId('heading')).toHaveText('About');
        await expect(page).toHaveURL(/\/about$/);
    });
});
