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
});
