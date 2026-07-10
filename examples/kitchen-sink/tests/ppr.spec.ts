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
        // The hole's Date survived the client round trip as a real Date (the
        // endpoint serializes with seroval, not JSON) — see @now/page.tsx.
        await expect(page.getByTestId('now-when')).toHaveText(
            '2024-01-02T03:04:05.000Z',
        );
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

    test('a boundary group with a NON-defer loader is still filled as a hole', async ({
        page,
    }) => {
        // Regression pin: the hole endpoint must serve boundary-group loaders
        // even when they are not `type: 'defer'` — under PPR the shell can't
        // resolve group resources, so they are always client-filled holes.
        await page.goto('/ppr');
        await expect(page.getByTestId('fresh-value')).toHaveText(
            'fresh-group-data',
        );
    });

    test('the loader endpoint returns a batched results envelope, seroval-serialized', async ({
        request,
    }) => {
        const res = await request.get(
            `/__solidstep_loader?manifest=${encodeURIComponent(
                '/group/ppr/@now',
            )}&url=${encodeURIComponent('/ppr')}`,
        );
        expect(res.status()).toBe(200);
        // seroval, not JSON: text/plain envelope that JSON.parse rejects but
        // still encodes the tick and a real `new Date(...)` for the hole's Date.
        expect(res.headers()['content-type']).toContain('text/plain');
        const body = await res.text();
        expect(() => JSON.parse(body)).toThrow();
        // `results` array, keyed by manifest -- not a bare top-level `data`.
        expect(body).toContain('results');
        expect(body).toContain('/group/ppr/@now');
        expect(body).toMatch(/tick:\d+|"tick":\d+|tick.*\d/);
        expect(body).toContain('new Date');
    });

    test('one request can batch multiple manifests, each resolving independently', async ({
        request,
    }) => {
        const url = new URL('http://x/__solidstep_loader');
        url.searchParams.append('manifest', '/group/ppr/@now');
        url.searchParams.append('manifest', '/group/ppr/@fresh');
        url.searchParams.set('url', '/ppr');
        const res = await request.get(url.pathname + url.search);
        expect(res.status()).toBe(200);
        const body = await res.text();
        expect(body).toContain('/group/ppr/@now');
        expect(body).toContain('/group/ppr/@fresh');
        expect(body).toContain('fresh-group-data');
    });

    test('the two first-load PPR holes on this page are fetched in ONE request, not two', async ({
        page,
    }) => {
        const loaderRequests: string[] = [];
        page.on('request', (req) => {
            if (req.url().includes('/__solidstep_loader')) {
                loaderRequests.push(req.url());
            }
        });

        await page.goto('/ppr');
        await expect(page.getByTestId('now-value')).toHaveText(/tick:\d+/);
        await expect(page.getByTestId('fresh-value')).toHaveText(
            'fresh-group-data',
        );

        expect(loaderRequests).toHaveLength(1);
        const requested = new URL(loaderRequests[0]);
        expect(requested.searchParams.getAll('manifest').sort()).toEqual(
            ['/group/ppr/@fresh', '/group/ppr/@now'].sort(),
        );
    });
});
