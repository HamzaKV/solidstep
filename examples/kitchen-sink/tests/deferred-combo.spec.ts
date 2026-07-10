import { test, expect } from '@playwright/test';

// /deferred-combo (app/deferred-combo/{layout,page}.tsx) has BOTH its layout
// loader and its page loader deferred on the same route, sharing the route's
// single loading.tsx -- the exact shape that duplicated <link>/<script> tags
// before the renderAssetsToHtml dedupe fix, and a real test of whether the
// createUniqueId id-collision guard holds when two independently-deferred
// boundaries (layout + page) are nested on one route, not just one at a time.
test.describe('a route with both a deferred layout and a deferred page', () => {
    test('does not duplicate the shared loading.tsx asset tags', async ({
        request,
    }) => {
        const res = await request.get('/deferred-combo');
        const html = await res.text();
        const loadingHrefs = [
            ...html.matchAll(/href="([^"]*loading[^"]*\.js)"/g),
        ].map((m) => m[1]);
        const uniqueHrefs = new Set(loadingHrefs);
        // Every href that appears should appear exactly once, not once per
        // independently-deferred boundary that pulled it in.
        for (const href of uniqueHrefs) {
            expect(loadingHrefs.filter((h) => h === href)).toHaveLength(1);
        }
    });

    test('both the layout and page content stream in correctly (no id collision between the two deferred boundaries)', async ({
        page,
    }) => {
        await page.goto('/deferred-combo');
        await expect(
            page.getByTestId('deferred-combo-layout-greeting'),
        ).toHaveText('combo-layout-loaded');
        await expect(
            page.getByTestId('deferred-combo-page-greeting'),
        ).toHaveText('combo-page-loaded');
    });

    test('soft-navigating to the combined route streams correctly', async ({
        page,
    }) => {
        await page.goto('/');
        await page.getByRole('link', { name: 'Layout+Page Streaming' }).click();
        await expect(
            page.getByTestId('deferred-combo-layout-greeting'),
        ).toHaveText('combo-layout-loaded');
        await expect(
            page.getByTestId('deferred-combo-page-greeting'),
        ).toHaveText('combo-page-loaded');
        await expect(page).toHaveURL(/\/deferred-combo$/);
    });

    test('soft-navigating fetches both deferred holes (layout + page) in ONE batched request', async ({
        page,
    }) => {
        const loaderRequests: string[] = [];
        page.on('request', (req) => {
            if (req.url().includes('/__solidstep_loader')) {
                loaderRequests.push(req.url());
            }
        });

        await page.goto('/');
        await page.getByRole('link', { name: 'Layout+Page Streaming' }).click();
        await expect(
            page.getByTestId('deferred-combo-layout-greeting'),
        ).toHaveText('combo-layout-loaded');
        await expect(
            page.getByTestId('deferred-combo-page-greeting'),
        ).toHaveText('combo-page-loaded');

        expect(loaderRequests).toHaveLength(1);
        const requested = new URL(loaderRequests[0]);
        expect(requested.searchParams.getAll('manifest')).toHaveLength(2);
    });
});
