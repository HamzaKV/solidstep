import { test, expect } from '@playwright/test';

test.describe('parallel routes (@slots) with concurrent loaders', () => {
    test('dashboard renders page plus both slots with their loader data', async ({
        page,
    }) => {
        await page.goto('/dashboard');
        await expect(page.getByTestId('dashboard-layout')).toBeVisible();
        await expect(page.getByTestId('dashboard-page')).toHaveText('Overview');
        await expect(page.getByTestId('analytics-visitors')).toHaveText('1234');
        await expect(page.getByTestId('team-count')).toHaveText('3');
    });

    test('slot loader data is server-rendered', async ({ request }) => {
        const res = await request.get('/dashboard');
        expect(res.status()).toBe(200);
        const html = await res.text();
        // Page loader + both slot loaders all resolved during SSR.
        expect(html).toContain('Overview');
        expect(html).toContain('1234');
    });
});
