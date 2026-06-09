import { test, expect } from '@playwright/test';

test.describe('per-group loading & error boundaries', () => {
    test('a failing group renders its error.tsx while sibling groups render', async ({
        page,
    }) => {
        await page.goto('/groups');
        await expect(page.getByTestId('groups-page')).toBeVisible();
        // The @ok group resolves and shows its streamed content.
        await expect(page.getByTestId('group-ok')).toHaveText(
            'ok-group-content',
        );
        // The @boom group's loader threw → its error.tsx, isolated from the rest.
        await expect(page.getByTestId('group-boom-error')).toContainText(
            'boom-group-failed',
        );
    });

    test('raw stream emits the group loading fallback before its content', async ({
        request,
    }) => {
        const res = await request.get('/groups');
        expect(res.status()).toBe(200);
        const html = await res.text();
        expect(html).toContain('ok-group-content');
        expect(html.indexOf('group-ok-loading')).toBeLessThan(
            html.indexOf('ok-group-content'),
        );
        // The failing group's error.tsx is rendered (page didn't crash).
        expect(html).toContain('boom-group-failed');
    });
});
