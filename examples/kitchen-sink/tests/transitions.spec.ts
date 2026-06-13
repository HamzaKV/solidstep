import { test, expect } from '@playwright/test';

// Pending UI + <Suspense> integration on navigation.
test.describe('transitions', () => {
    test('shows the pending indicator while a slow route loads, then hides it', async ({
        page,
    }) => {
        await page.goto('/');
        // /slow has a 600ms sequential loader, so the envelope fetch (and thus
        // the global pending indicator) is observable.
        await page.getByRole('link', { name: 'Slow' }).click();
        await expect(page.getByTestId('nav-progress')).toBeVisible();
        await expect(page.getByTestId('slow-content')).toBeVisible();
        await expect(page.getByTestId('nav-progress')).toBeHidden();
    });

    test('streams a deferred route: loading.tsx shows, then the hole fills', async ({
        page,
    }) => {
        await page.goto('/');
        let reloaded = false;
        page.on('load', () => {
            reloaded = true;
        });

        await page.getByRole('link', { name: 'Deferred' }).click();

        // The shell commits instantly and the deferred hole shows its fallback…
        await expect(page.getByTestId('deferred-loading')).toBeVisible();
        // …then the streamed loader data fills in.
        await expect(page.getByTestId('deferred-content')).toHaveText(
            'deferred-content-loaded',
        );
        await expect(page).toHaveURL(/\/deferred$/);
        expect(reloaded).toBe(false); // soft navigation, not a full reload
    });
});
