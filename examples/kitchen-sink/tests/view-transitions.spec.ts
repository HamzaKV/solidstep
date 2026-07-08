import { test, expect } from '@playwright/test';

// `<Link viewTransition>` should wrap the client-side navigation commit in
// `document.startViewTransition()` when the browser supports it and the user
// hasn't requested reduced motion; otherwise it degrades to a direct commit.
test.describe('view transitions', () => {
    test('an opted-in Link wraps its navigation in document.startViewTransition', async ({
        page,
    }) => {
        await page.addInitScript(() => {
            (window as Window & { __vtCalls?: number }).__vtCalls = 0;
            (
                document as Document & { startViewTransition?: unknown }
            ).startViewTransition = (callback: () => void | Promise<void>) => {
                (window as Window & { __vtCalls?: number }).__vtCalls!++;
                const ready = Promise.resolve(callback());
                return {
                    ready,
                    finished: ready,
                    updateCallbackDone: ready,
                    skipTransition: () => undefined,
                };
            };
        });

        await page.goto('/');
        await page.getByRole('link', { name: 'About' }).click();

        await expect(page.getByTestId('heading')).toHaveText('About');
        expect(
            await page.evaluate(
                () => (window as Window & { __vtCalls?: number }).__vtCalls,
            ),
        ).toBe(1);
    });

    test('prefers-reduced-motion skips the view transition even when opted in', async ({
        page,
    }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.addInitScript(() => {
            (window as Window & { __vtCalls?: number }).__vtCalls = 0;
            (
                document as Document & { startViewTransition?: unknown }
            ).startViewTransition = (callback: () => void | Promise<void>) => {
                (window as Window & { __vtCalls?: number }).__vtCalls!++;
                const ready = Promise.resolve(callback());
                return {
                    ready,
                    finished: ready,
                    updateCallbackDone: ready,
                    skipTransition: () => undefined,
                };
            };
        });

        await page.goto('/');
        await page.getByRole('link', { name: 'About' }).click();

        await expect(page.getByTestId('heading')).toHaveText('About');
        expect(
            await page.evaluate(
                () => (window as Window & { __vtCalls?: number }).__vtCalls,
            ),
        ).toBe(0);
    });

    test('a Link without viewTransition does not call startViewTransition', async ({
        page,
    }) => {
        await page.addInitScript(() => {
            (window as Window & { __vtCalls?: number }).__vtCalls = 0;
            (
                document as Document & { startViewTransition?: unknown }
            ).startViewTransition = (callback: () => void | Promise<void>) => {
                (window as Window & { __vtCalls?: number }).__vtCalls!++;
                const ready = Promise.resolve(callback());
                return {
                    ready,
                    finished: ready,
                    updateCallbackDone: ready,
                    skipTransition: () => undefined,
                };
            };
        });

        await page.goto('/');
        await page.getByRole('link', { name: 'Counter' }).click();

        await expect(page).toHaveURL(/\/counter$/);
        expect(
            await page.evaluate(
                () => (window as Window & { __vtCalls?: number }).__vtCalls,
            ),
        ).toBe(0);
    });

    // Each history entry remembers whether *arriving* at it was a view
    // transition (recorded via `pushState` at navigate time). The very first
    // (hard-loaded) entry never had a chance to record that, so going back to
    // it doesn't replay a transition; forward-navigating to an entry that was
    // originally reached via a view-transition Link does.
    test('forward-navigating back to a view-transition entry replays the transition', async ({
        page,
    }) => {
        await page.addInitScript(() => {
            (window as Window & { __vtCalls?: number }).__vtCalls = 0;
            (
                document as Document & { startViewTransition?: unknown }
            ).startViewTransition = (callback: () => void | Promise<void>) => {
                (window as Window & { __vtCalls?: number }).__vtCalls!++;
                const ready = Promise.resolve(callback());
                return {
                    ready,
                    finished: ready,
                    updateCallbackDone: ready,
                    skipTransition: () => undefined,
                };
            };
        });

        await page.goto('/');
        await page.getByRole('link', { name: 'About' }).click();
        await expect(page.getByTestId('heading')).toHaveText('About');
        expect(
            await page.evaluate(
                () => (window as Window & { __vtCalls?: number }).__vtCalls,
            ),
        ).toBe(1);

        // Back to the hard-loaded "/" entry, which never recorded a
        // view-transition preference — no replay.
        await page.goBack();
        await expect(page.getByTestId('heading')).toHaveText('Kitchen Sink');
        expect(
            await page.evaluate(
                () => (window as Window & { __vtCalls?: number }).__vtCalls,
            ),
        ).toBe(1);

        // Forward again, back to the "/about" entry pushed with
        // viewTransition: true — replays.
        await page.goForward();
        await expect(page.getByTestId('heading')).toHaveText('About');
        expect(
            await page.evaluate(
                () => (window as Window & { __vtCalls?: number }).__vtCalls,
            ),
        ).toBe(2);
    });

    // The real API rejects `updateCallbackDone`/`finished` if the transition
    // callback throws -- nobody awaited those promises, so that rejection was
    // unhandled. Simulate it directly via a stub that rejects immediately.
    test("a view-transition callback's exception does not surface as an unhandled promise rejection", async ({
        page,
    }) => {
        await page.addInitScript(() => {
            (window as Window & { __unhandled?: string | null }).__unhandled =
                null;
            window.addEventListener('unhandledrejection', (e) => {
                (
                    window as Window & { __unhandled?: string | null }
                ).__unhandled = String(e.reason);
            });
            (
                document as Document & { startViewTransition?: unknown }
            ).startViewTransition = (callback: () => void | Promise<void>) => {
                callback();
                const updateCallbackDone = Promise.reject(
                    new Error('transition callback boom'),
                );
                return {
                    ready: Promise.resolve(),
                    finished: Promise.resolve(),
                    updateCallbackDone,
                    skipTransition: () => undefined,
                };
            };
        });

        await page.goto('/');
        await page.getByRole('link', { name: 'About' }).click();
        await expect(page.getByTestId('heading')).toHaveText('About');
        await page.waitForTimeout(100);

        expect(
            await page.evaluate(
                () =>
                    (window as Window & { __unhandled?: string | null })
                        .__unhandled,
            ),
        ).toBeNull();
    });
});
