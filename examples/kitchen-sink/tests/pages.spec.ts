import { test, expect } from '@playwright/test';

test.describe('SSR pages & routing', () => {
    test('home page renders loader data and metadata', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByTestId('heading')).toHaveText('Kitchen Sink');
        await expect(page.getByTestId('loader-message')).toHaveText(
            'hello from the home loader',
        );
        await expect(page).toHaveTitle('Kitchen Sink — Home');
        await expect(page.getByTestId('nav')).toBeVisible();
    });

    test('home page content is server-rendered (present in raw HTML)', async ({
        request,
    }) => {
        const res = await request.get('/');
        expect(res.status()).toBe(200);
        const html = await res.text();
        expect(html).toContain('hello from the home loader');
        expect(html).toContain('<title>Kitchen Sink — Home</title>');
    });

    test('static nested route /about', async ({ page }) => {
        await page.goto('/about');
        await expect(page.getByTestId('heading')).toHaveText('About');
        await expect(page).toHaveTitle('About — Kitchen Sink');
    });

    test('dynamic param /blog/[slug]', async ({ page }) => {
        await page.goto('/blog/hello-world');
        await expect(page.getByTestId('slug')).toHaveText('hello-world');
    });

    test('catch-all /docs/[...path]', async ({ page }) => {
        await page.goto('/docs/a/b/c');
        await expect(page.getByTestId('path')).toHaveText('a/b/c');
        await expect(page.getByTestId('depth')).toHaveText('3');
    });

    test('optional catch-all /shop/[[...path]] matches base path', async ({
        page,
    }) => {
        await page.goto('/shop');
        await expect(page.getByTestId('path')).toHaveText('(root)');
    });

    test('optional catch-all /shop/[[...path]] matches nested path', async ({
        page,
    }) => {
        await page.goto('/shop/electronics/phones');
        await expect(page.getByTestId('path')).toHaveText('electronics/phones');
    });
});
