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

    test('a deferred group whose loader rejects renders its error.tsx with the thrown message', async ({
        page,
    }) => {
        // The loader rejects after the shell has already streamed past this
        // group's boundary — the client must self-heal via the resource's own
        // (reactive) error state, not solid's throw-catch (which is gated by
        // an internal `firstFlushed` flag for post-flush rejections).
        await page.goto('/groups');
        await expect(page.getByTestId('group-boomdeferred-error')).toHaveText(
            'group error: boom-deferred-group-failed',
        );
    });

    test('soft-navigating to a deferred group streams its loading.tsx then content', async ({
        page,
    }) => {
        await page.goto('/');
        let reloaded = false;
        page.on('load', () => {
            reloaded = true;
        });

        await page.getByRole('link', { name: 'Groups' }).click();

        // The @ok group's loader is deferred → its loading.tsx shows first…
        await expect(page.getByTestId('group-ok-loading')).toBeVisible();
        // …then its streamed content fills in (fetched via the hole endpoint).
        await expect(page.getByTestId('group-ok')).toHaveText(
            'ok-group-content',
        );
        await expect(page).toHaveURL(/\/groups$/);
        expect(reloaded).toBe(false); // soft navigation, not a full reload
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
