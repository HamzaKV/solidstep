import { test, expect } from '@playwright/test';

// A deferred loader with no error.tsx that throws had nothing local to catch
// it client-side: the rejection threw uncaught through hydrate() and crashed
// the ENTIRE page's hydration (observed: blank <main>, no visible error,
// repeated unhandled pageerror events) -- not just this one slot. Fixed by
// always wrapping a Suspense-ed node in an ErrorBoundary (with a silent
// default fallback when the author provided no error.tsx), both server- and
// client-side, so a failure is contained to its own boundary.

test.describe('deferred loader failure with no error boundary', () => {
    test('the raw response is still a complete, well-formed document', async ({
        request,
    }) => {
        const res = await request.get('/deferred-noerror-fail');
        expect(res.status()).toBe(200);
        const html = await res.text();
        expect(html).toContain('deferred-noerror-fail-loading');
        expect(html).toContain('</html>');
    });

    test('the rest of the page hydrates fine; the failure is contained, not a blank-page crash', async ({
        page,
    }) => {
        await page.goto('/deferred-noerror-fail');
        await page.waitForTimeout(500); // let the 100ms loader rejection settle

        // Before the fix: <main> hydration aborted entirely (blank page) --
        // even the nav (outside the failing boundary) never mounted. After
        // the fix: everything outside the failing slot hydrates normally.
        await expect(page.getByRole('link', { name: 'Home' })).toBeVisible();
        await expect(
            page.getByRole('link', { name: 'Deferred', exact: true }),
        ).toBeVisible();
        // The page is genuinely interactive, not frozen mid-crash.
        await page.getByRole('link', { name: 'Home' }).click();
        await expect(page).toHaveURL(/\/$/);
    });
});
