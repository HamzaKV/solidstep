import { test, expect } from '@playwright/test';

test.describe('organizational route groups ( (group) folders )', () => {
    test('a (group) folder is stripped from the URL and its layout still wraps the route', async ({
        page,
    }) => {
        const res = await page.goto('/pricing');
        expect(res?.status()).toBe(200);
        await expect(page.getByTestId('pricing')).toHaveText('pricing-page');
        // The (marketing) layout applies even though it is not part of the URL.
        await expect(page.getByTestId('marketing-banner')).toHaveText(
            'marketing-group-layout',
        );
    });

    test('the literal (group) path is not routable', async ({ page }) => {
        const res = await page.goto('/(marketing)/pricing');
        expect(res?.status()).toBe(404);
    });
});
