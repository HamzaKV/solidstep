import { test, expect } from '@playwright/test';

test.describe('cache tags + invalidation', () => {
    test('the tagged loader value is cached and bumps after invalidateTag', async ({
        page,
    }) => {
        await page.goto('/cache-tags');
        const value = page.getByTestId('cached-value');
        const initial = (await value.textContent())!; // e.g. "value:1"

        // A reload serves the cached render/loader data — same value.
        await page.reload();
        await expect(value).toHaveText(initial);

        // The action invalidates the 'products' tag and revalidates the path,
        // diffing the refreshed HTML into the live DOM.
        await page.getByTestId('revalidate').click();
        await expect(page.getByTestId('revalidations')).toHaveText(
            'revalidations:1',
        );
        // Loader re-ran on revalidation → the counter bumped.
        await expect(value).not.toHaveText(initial);
    });
});
