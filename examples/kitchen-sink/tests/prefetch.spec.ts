import { test, expect } from '@playwright/test';

// `<Link>` prefetches the target route's data envelope on hover (the default),
// so the subsequent click renders instantly without a second request.
test.describe('prefetch', () => {
    test('hovering a link prefetches; the click reuses it (no second request)', async ({
        page,
    }) => {
        await page.goto('/');

        const routeRequests: string[] = [];
        page.on('request', (r) => {
            const u = r.url();
            if (u.includes('__solidstep_route') && u.includes('about')) {
                routeRequests.push(u);
            }
        });

        // Hover → one prefetch request for /about.
        await page.getByRole('link', { name: 'About' }).hover();
        await expect.poll(() => routeRequests.length).toBe(1);

        // Click → renders from the prefetch cache; no additional request.
        await page.getByRole('link', { name: 'About' }).click();
        await expect(page.getByTestId('heading')).toHaveText('About');
        expect(routeRequests.length).toBe(1);
    });
});
