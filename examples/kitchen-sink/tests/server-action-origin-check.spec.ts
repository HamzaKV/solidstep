import { test, expect } from '@playwright/test';

// Server functions (/_server) get a built-in origin check (distinct from the
// app's own csrf()/cors() middleware in middleware.spec.ts, which guards
// api routes). These hit /_server directly to pin that check end-to-end.
test.describe('built-in /_server origin check', () => {
    test('rejects a cross-origin POST with a 403', async ({ request }) => {
        const res = await request.post('/_server?id=x&name=y', {
            headers: { origin: 'https://evil.example.com' },
            data: {},
        });
        expect(res.status()).toBe(403);
    });

    test('a same-origin direct POST with a malformed JSON body 400s (not blocked by the origin check)', async ({
        page,
        request,
    }) => {
        // Under a fully-parallel local run (many workers sharing one CPU),
        // hydration + the click round trip can occasionally outrun the
        // default 30s — give this one more headroom rather than flaking.
        test.setTimeout(60_000);
        await page.goto('/counter');
        // Wait for hydration so the click is handled by the client (fetch to
        // /_server) rather than racing a pre-hydration native form submit.
        await expect(page.getByTestId('count')).toHaveText('0');
        const [serverReq] = await Promise.all([
            page.waitForRequest((req) => req.url().includes('/_server'), {
                timeout: 45_000,
            }),
            page.getByTestId('submit').click(),
        ]);
        const original = serverReq.headers();
        const res = await request.post(serverReq.url(), {
            headers: {
                'content-type': 'application/json',
                'x-server-id': original['x-server-id'],
                'x-server-instance': original['x-server-instance'],
            },
            data: 'not json',
        });
        expect(res.status()).toBe(400);
    });
});
