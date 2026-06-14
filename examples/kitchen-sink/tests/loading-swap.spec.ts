import { test, expect } from '@playwright/test';

// Coverage for the non-destructive loading-placeholder head swap in server.ts.
// This route HAS a loading.tsx but uses a plain sequential loader (not defer)
// and no parallel-route boundary group, so it takes the "flush loading shell,
// then swap to the real page" path — not the streaming path. The swap merges
// the new head nodes in place rather than wiping <head>, so hydration/manifest
// scripts and asset <link>s survive and the page stays interactive under CSP.
test.describe('loading-placeholder head swap', () => {
    test('flushes the loading boundary first', async ({ request }) => {
        // The loading.tsx markup is flushed while the sequential loader resolves.
        const res = await request.get('/loading-swap');
        expect(res.status()).toBe(200);
        expect(await res.text()).toContain('Loading swap page');
    });

    test('swaps in the real page with intact head, assets, and hydration', async ({
        page,
    }) => {
        const consoleErrors: string[] = [];
        const pageErrors: string[] = [];
        page.on('console', (msg) => {
            if (msg.type() === 'error') consoleErrors.push(msg.text());
        });
        page.on('pageerror', (e) => pageErrors.push(String(e)));

        await page.goto('/loading-swap');

        // After the swap the real content is shown (not the loading text).
        await expect(page.getByTestId('swap-content')).toHaveText(
            'loaded: true',
        );
        await expect(page.getByTestId('loading')).toHaveCount(0);

        // The page's generateMeta survives the head merge.
        await expect(page).toHaveTitle('Loading Swap — Kitchen Sink');
        const description = await page
            .locator('meta[name="description"]')
            .getAttribute('content');
        expect(description).toBe('Loading swap head-merge fixture');
        // The dedup keeps a single description meta (page overrides layout).
        expect(await page.locator('meta[name="description"]').count()).toBe(1);
        // Base charset meta is preserved (not duplicated) by the merge.
        expect(await page.locator('meta[charset]').count()).toBe(1);

        // The CSS/asset <link>s are present (globals.css is imported by the
        // root layout, so a stylesheet link must survive the swap).
        expect(
            await page.locator('head link[rel="stylesheet"]').count(),
        ).toBeGreaterThan(0);

        // The page is interactive (hydrated): the client router intercepts Links.
        await expect(page.getByTestId('nav')).toBeVisible();
        await page.getByRole('link', { name: 'About' }).click();
        await expect(page.getByTestId('heading')).toHaveText('About');

        // CSP nonce is applied (middleware sets one) and the inline swap script
        // ran without violations: no console errors and no page errors.
        expect(pageErrors).toEqual([]);
        expect(consoleErrors).toEqual([]);
    });
});
