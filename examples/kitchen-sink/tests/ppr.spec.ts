import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const shellArtifact = join(
    here,
    '..',
    '.output',
    'public',
    'ppr',
    'index.html',
);
const stripComments = (html: string) => html.replace(/<!--[^>]*-->/g, '');

test.describe('PPR (render: ppr)', () => {
    test('build prerenders a static shell artifact with the hole fallback, not the dynamic value', () => {
        expect(existsSync(shellArtifact)).toBe(true);
        const shell = stripComments(readFileSync(shellArtifact, 'utf-8'));
        // Static parts are baked in.
        expect(shell).toContain('static-shell-content');
        expect(shell).toContain('now-loading');
        // The dynamic hole value must NOT be in the prebuilt shell.
        expect(shell).not.toMatch(/tick:\d+/);
    });

    test('the client fills the dynamic hole after loading the static shell', async ({
        page,
    }) => {
        await page.goto('/ppr');
        // Static shell is present immediately.
        await expect(page.getByTestId('ppr-static')).toHaveText(
            'static-shell-content',
        );
        // The island is filled client-side via the loader endpoint.
        await expect(page.getByTestId('now-value')).toHaveText(/tick:\d+/);
    });

    test('the hole is dynamic per request (value differs across visits)', async ({
        page,
    }) => {
        const read = async () => {
            await page.goto('/ppr');
            await expect(page.getByTestId('now-value')).toHaveText(/tick:\d+/);
            const text = (await page.getByTestId('now-value').textContent())!;
            return Number(text.replace(/\D/g, ''));
        };
        const first = await read();
        const second = await read();
        expect(second).not.toBe(first);
    });

    test('the loader endpoint returns the hole data as JSON', async ({
        request,
    }) => {
        const res = await request.get(
            '/__solidstep_loader?manifest=' +
                encodeURIComponent('/group/ppr/@now') +
                '&url=' +
                encodeURIComponent('/ppr'),
        );
        expect(res.status()).toBe(200);
        const body = await res.json();
        expect(typeof body.data.tick).toBe('number');
    });
});
