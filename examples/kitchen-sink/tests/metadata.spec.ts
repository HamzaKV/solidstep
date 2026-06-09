import { test, expect } from '@playwright/test';

test.describe('dynamic metadata files', () => {
    test('GET /robots.txt returns text with the configured rules', async ({
        request,
    }) => {
        const res = await request.get('/robots.txt');
        expect(res.status()).toBe(200);
        expect(res.headers()['content-type']).toContain('text/plain');
        const body = await res.text();
        expect(body).toContain('User-agent: *');
        expect(body).toContain('Disallow: /admin');
        expect(body).toContain('Sitemap: https://example.com/sitemap.xml');
    });

    test('GET /sitemap.xml returns a valid urlset', async ({ request }) => {
        const res = await request.get('/sitemap.xml');
        expect(res.status()).toBe(200);
        expect(res.headers()['content-type']).toContain('application/xml');
        const body = await res.text();
        expect(body).toContain('<?xml version="1.0" encoding="UTF-8"?>');
        expect(body).toContain('<loc>https://example.com/</loc>');
        expect(body).toContain('<changefreq>daily</changefreq>');
    });

    test('GET /manifest.webmanifest returns JSON manifest', async ({
        request,
    }) => {
        const res = await request.get('/manifest.webmanifest');
        expect(res.status()).toBe(200);
        expect(res.headers()['content-type']).toContain(
            'application/manifest+json',
        );
        expect(await res.json()).toMatchObject({
            name: 'Kitchen Sink',
            display: 'standalone',
        });
    });

    test('GET /llms.txt returns text', async ({ request }) => {
        const res = await request.get('/llms.txt');
        expect(res.status()).toBe(200);
        expect(res.headers()['content-type']).toContain('text/plain');
        expect(await res.text()).toContain('# Kitchen Sink');
    });
});
