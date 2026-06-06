import { test, expect } from '@playwright/test';

test.describe('server actions via useActionState', () => {
    test('page is server-rendered with the initial state', async ({ request }) => {
        const res = await request.get('/counter');
        expect(res.status()).toBe(200);
        const html = await res.text();
        expect(html).toContain('Counter');
    });

    test('submitting runs the server action and updates state', async ({
        page,
    }) => {
        await page.goto('/counter');
        await expect(page.getByTestId('count')).toHaveText('0');

        // Default step is 1.
        await page.getByTestId('submit').click();
        await expect(page.getByTestId('count')).toHaveText('1');

        // Run it again to confirm prevState is threaded through.
        await page.getByTestId('submit').click();
        await expect(page.getByTestId('count')).toHaveText('2');
    });

    test('respects a custom step value', async ({ page }) => {
        await page.goto('/counter');
        await page.getByTestId('step').fill('5');
        await page.getByTestId('submit').click();
        await expect(page.getByTestId('count')).toHaveText('5');
    });

    test('surfaces a thrown action error via the error accessor', async ({
        page,
    }) => {
        await page.goto('/counter');
        await page.getByTestId('step').fill('not-a-number');
        await page.getByTestId('submit').click();

        await expect(page.getByTestId('error')).toHaveText('step must be a number');
        // State is unchanged after a failed action.
        await expect(page.getByTestId('count')).toHaveText('0');
    });

    test('error clears on a subsequent successful submission', async ({ page }) => {
        await page.goto('/counter');

        await page.getByTestId('step').fill('bad');
        await page.getByTestId('submit').click();
        await expect(page.getByTestId('error')).toBeVisible();

        await page.getByTestId('step').fill('3');
        await page.getByTestId('submit').click();
        await expect(page.getByTestId('count')).toHaveText('3');
        await expect(page.getByTestId('error')).toHaveCount(0);
    });
});
