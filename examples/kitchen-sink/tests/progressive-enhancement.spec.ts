import { test, expect } from '@playwright/test';

// With JavaScript disabled, <Link> must still work as a plain anchor: clicking
// it performs a normal full-page navigation and the target route SSR-renders.
test.describe('progressive enhancement (no JS)', () => {
    test.use({ javaScriptEnabled: false });

    test('<Link> renders a real anchor that navigates without JS', async ({
        page,
    }) => {
        await page.goto('/');
        const about = page.getByRole('link', { name: 'About' });
        await expect(about).toHaveAttribute('href', '/about');
        await about.click();
        await expect(page).toHaveURL(/\/about$/);
        await expect(page.getByTestId('heading')).toHaveText('About');
    });
});
