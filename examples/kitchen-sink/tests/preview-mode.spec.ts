import { test, expect } from '@playwright/test';

// /isr (app/isr/page.tsx) bumps a module-level counter on every real render
// and is `render: 'isr'` cached -- perfect for proving preview mode bypasses
// the ISR cache read without touching its write.
test.describe('preview mode', () => {
    test('an active preview cookie forces a fresh render on every request, bypassing ISR', async ({
        request,
    }) => {
        // Warm the ISR cache.
        const before = await (await request.get('/isr')).text();

        const enableRes = await request.post('/api/preview/enable');
        expect(enableRes.status()).toBe(200);

        const preview1 = await (await request.get('/isr')).text();
        const preview2 = await (await request.get('/isr')).text();

        // Two preview requests in immediate succession both re-rendered (the
        // counter advanced each time), unlike the ISR-cached `before` value.
        expect(preview1).not.toBe(before);
        expect(preview2).not.toBe(preview1);

        const disableRes = await request.post('/api/preview/disable');
        expect(disableRes.status()).toBe(200);

        // Preview's fresh renders never wrote to the ISR cache -- back to
        // whatever was last actually cached (not continuing to advance).
        const after1 = await (await request.get('/isr')).text();
        const after2 = await (await request.get('/isr')).text();
        expect(after1).toBe(after2);
    });

    test('a tampered preview cookie is ignored (ISR cache still applies)', async ({
        request,
    }) => {
        const before = await (await request.get('/isr')).text();

        const res = await request.get('/isr', {
            headers: {
                cookie: 'solidstep_preview=active.not-a-real-signature',
            },
        });
        const tampered = await res.text();

        expect(tampered).toBe(before);
    });

    // /cached (app/cached/page.tsx) bumps a module-level counter on each real
    // loader run and caches the result via the LOADER's own `options.cache`
    // (loader-cache.ts) -- a different code path than /isr's ISR short-circuit
    // above, exercising the page/loader-cache preview-isolation fix directly.
    const cachedValue = (html: string) => html.match(/value:(\d+)/)?.[1];

    test('preview reads/writes a namespace isolated from the published loader cache', async ({
        request,
    }) => {
        const published1 = cachedValue(
            await (await request.get('/cached')).text(),
        );
        const published2 = cachedValue(
            await (await request.get('/cached')).text(),
        );
        // Published cache is warm: unchanged across requests.
        expect(published1).toBe(published2);

        await request.post('/api/preview/enable');

        const preview1 = cachedValue(
            await (await request.get('/cached')).text(),
        );
        // Preview does not read the published cache -- a fresh value.
        expect(preview1).not.toBe(published1);

        const preview2 = cachedValue(
            await (await request.get('/cached')).text(),
        );
        // A second preview request reuses PREVIEW's own cache entry --
        // preview still benefits from caching, it's just isolated.
        expect(preview2).toBe(preview1);

        await request.post('/api/preview/disable');

        // Back to non-preview: still the original published value, untouched
        // by anything the preview requests wrote.
        const publishedAgain = cachedValue(
            await (await request.get('/cached')).text(),
        );
        expect(publishedAgain).toBe(published1);
    });
});
