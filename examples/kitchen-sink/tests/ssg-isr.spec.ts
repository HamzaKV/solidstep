import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, '..', '.output', 'public');

const stripComments = (html: string) => html.replace(/<!--[^>]*-->/g, '');

test.describe('SSG (render: static)', () => {
    test('a static route is prerendered to a .html artifact at build time', () => {
        const artifact = join(publicDir, 'ssg', 'index.html');
        expect(existsSync(artifact)).toBe(true);
        expect(readFileSync(artifact, 'utf-8')).toContain('static-content');
    });

    test('a dynamic static route writes one artifact per generateStaticParams entry', () => {
        for (const id of ['1', '2']) {
            const artifact = join(publicDir, 'products', id, 'index.html');
            expect(existsSync(artifact)).toBe(true);
            expect(stripComments(readFileSync(artifact, 'utf-8'))).toContain(
                `id:${id}`,
            );
        }
    });

    test('the static route is served (200) with its content', async ({
        request,
    }) => {
        const res = await request.get('/ssg');
        expect(res.status()).toBe(200);
        expect(res.text ? await res.text() : '').toContain('static-content');
    });

    test('a non-generated dynamic id still renders dynamically', async ({
        page,
    }) => {
        await page.goto('/products/99');
        await expect(page.getByTestId('product-id')).toHaveText('id:99');
    });
});

test.describe('ISR (render: isr)', () => {
    const readValue = (html: string) =>
        Number(stripComments(html).match(/n:(\d+)/)?.[1] ?? 'NaN');

    test('emits a valued stale-while-revalidate directive (RFC 5861)', async ({
        request,
    }) => {
        const res = await request.get('/isr');
        expect(res.status()).toBe(200);
        // Bare `stale-while-revalidate` (no =seconds) is non-conformant and
        // ignored by CDNs; the SWR window must carry a value.
        expect(res.headers()['cache-control']).toMatch(
            /stale-while-revalidate=\d+/,
        );
    });

    test('serves a cached artifact and regenerates after the revalidate window', async ({
        request,
    }) => {
        const first = await request.get('/isr');
        expect(first.status()).toBe(200);
        const initial = readValue(await first.text());
        expect(Number.isNaN(initial)).toBe(false);

        // The counter resets per process, so the served process re-counts from a
        // cold module; poll across revalidation windows until it advances past
        // the initial value (proving background regeneration ran).
        let advanced = false;
        for (let i = 0; i < 10 && !advanced; i++) {
            await new Promise((r) => setTimeout(r, 1200)); // > revalidate (1s)
            const res = await request.get('/isr');
            if (readValue(await res.text()) > initial) advanced = true;
        }
        expect(advanced).toBe(true);
    });
});
