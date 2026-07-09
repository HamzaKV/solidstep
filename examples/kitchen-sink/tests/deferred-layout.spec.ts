import { test, expect } from '@playwright/test';

test.describe('deferred layout loaders', () => {
    test('raw stream emits the layout loading fallback before its content', async ({
        request,
    }) => {
        const res = await request.get('/deferred-layout');
        expect(res.status()).toBe(200);
        const html = await res.text();
        expect(html).toContain('hello-from-deferred-layout');
        expect(html.indexOf('deferred-layout-loading')).toBeLessThan(
            html.indexOf('hello-from-deferred-layout'),
        );
    });

    test('streams the loading fallback then hydrates with the real content, no hydration-mismatch console errors', async ({
        page,
    }) => {
        const consoleErrors: string[] = [];
        page.on('console', (msg) => {
            if (msg.type() === 'error') consoleErrors.push(msg.text());
        });

        await page.goto('/deferred-layout');
        await expect(page.getByTestId('deferred-layout-greeting')).toHaveText(
            'hello-from-deferred-layout',
        );
        await expect(page.getByTestId('deferred-layout-page')).toHaveText(
            'page content',
        );

        expect(consoleErrors.filter((t) => /hydrat/i.test(t))).toEqual([]);
    });

    test('soft-navigating to a deferred layout streams its loading.tsx then content', async ({
        page,
    }) => {
        await page.goto('/');
        let reloaded = false;
        page.on('load', () => {
            reloaded = true;
        });

        await page
            .getByRole('link', { name: 'Layout Streaming', exact: true })
            .click();

        await expect(page.getByTestId('deferred-layout-greeting')).toHaveText(
            'hello-from-deferred-layout',
        );
        await expect(page).toHaveURL(/\/deferred-layout$/);
        expect(reloaded).toBe(false);
    });

    test('a deferred layout loader that rejects renders the route error.tsx (no loading.tsx present)', async ({
        page,
    }) => {
        await page.goto('/deferred-layout-fail');
        await expect(page.getByTestId('deferred-layout-fail-error')).toHaveText(
            'layout error: deferred-layout-failed',
        );
    });

    // Two deferred layouts stacked in the SAME chain (not just one deferred
    // layout + one deferred page, which `deferred-combo.spec.ts` already
    // covers) -- each burns its own createUniqueId() for its own
    // ErrorBoundary. Only the INNER layout fails here: if the OUTER also
    // failed, its ErrorBoundary would correctly catch it and unmount the
    // inner layout's subtree entirely before it ever mounts (normal
    // ErrorBoundary nesting semantics, not something to test around) --
    // this asymmetric case is what actually isolates whether the inner
    // layout's own hydration id got shifted/collided by the outer one.
    test('the outer layout succeeds while the inner (stacked) layout fails -- the inner error surfaces correctly, not garbled by an id collision', async ({
        page,
    }) => {
        const consoleErrors: string[] = [];
        page.on('console', (msg) => {
            if (msg.type() === 'error') consoleErrors.push(msg.text());
        });

        await page.goto('/deferred-layout-stack/nested');

        await expect(
            page.getByTestId('deferred-layout-stack-greeting'),
        ).toHaveText('hello-from-outer-stacked-layout');
        await expect(
            page.getByTestId('deferred-layout-stack-error'),
        ).toHaveText('stack error: nested-stacked-layout-failed');

        expect(consoleErrors.filter((t) => /hydrat/i.test(t))).toEqual([]);
    });
});
