import { test, expect } from '@playwright/test';

// Regression coverage for the Phase 0 hardening fixes:
// - default dynamic pages are not cached (and the cache key includes ?query)
// - loader data / metadata are escaped so they cannot break out of HTML/scripts
// - loader data is serialized with seroval so Date/Map survive on the client
test.describe('Phase 0 hardening', () => {
    test('default dynamic page is not cached (loader runs every request)', async ({
        request,
    }) => {
        const first = await request.get('/phase0');
        const second = await request.get('/phase0');
        const runsOf = (html: string) =>
            html.match(/data-testid="runs"[^>]*>(\d+)</)?.[1];
        const a = runsOf(await first.text());
        const b = runsOf(await second.text());
        expect(a).toBeDefined();
        expect(b).toBeDefined();
        // If the page were wrongly cached forever, both renders would be equal.
        expect(Number(b)).toBeGreaterThan(Number(a as string));
    });

    test('query string is part of the cache key (no ?q collision)', async ({
        request,
    }) => {
        const qOf = (html: string) =>
            html.match(/data-testid="q"[^>]*>([^<]*)</)?.[1] ?? '';
        const a = await (await request.get('/phase0?q=alpha')).text();
        const b = await (await request.get('/phase0?q=beta')).text();
        expect(qOf(a)).toBe('alpha');
        expect(qOf(b)).toBe('beta');
    });

    test('loader data containing </script> does not break out (no XSS)', async ({
        page,
    }) => {
        const errors: string[] = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        await page.goto('/phase0');
        // The malicious string is rendered as inert text content.
        await expect(page.getByTestId('xss')).toContainText('</script>');
        // No injected element escaped the hydration script...
        expect(await page.locator('img[data-xss="1"]').count()).toBe(0);
        // ...and the onerror payload never executed.
        expect(
            await page.evaluate(() => (window as any).__xss),
        ).toBeUndefined();
        expect(errors).toEqual([]);
    });

    test('metadata attribute values are HTML-escaped (no injected script)', async ({
        page,
    }) => {
        await page.goto('/phase0');
        expect(
            await page.evaluate(() => (window as any).__metaxss),
        ).toBeUndefined();
        const content = await page
            .locator('meta[name="description"]')
            .getAttribute('content');
        expect(content).toBe('"><script>window.__metaxss=1</script>');
    });

    test('loader Date and Map survive serialization on the client (seroval)', async ({
        page,
    }) => {
        await page.goto('/phase0');
        // These testids are populated in onMount from the client-side loaderData.
        await expect(page.getByTestId('when-type')).toHaveText('Date');
        await expect(page.getByTestId('tags-type')).toHaveText('Map');
        await expect(page.getByTestId('tags-value')).toHaveText('alpha');
    });
});
