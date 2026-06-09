import { describe, it, expect } from 'vitest';
import { robots, sitemap } from '../utils/metadata';

describe('sitemap', () => {
    it('renders an empty urlset', () => {
        const xml = sitemap([]);
        expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
        expect(xml).toContain(
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        );
        expect(xml).toContain('</urlset>');
        expect(xml).not.toContain('<url>');
    });

    it('renders a url with only a loc', () => {
        const xml = sitemap([{ url: 'https://example.com/' }]);
        expect(xml).toContain('<url><loc>https://example.com/</loc></url>');
    });

    it('includes lastmod (from a Date), changefreq, and priority', () => {
        const xml = sitemap([
            {
                url: 'https://example.com/a',
                lastModified: new Date('2026-01-02T03:04:05.000Z'),
                changeFrequency: 'weekly',
                priority: 0.8,
            },
        ]);
        expect(xml).toContain('<lastmod>2026-01-02T03:04:05.000Z</lastmod>');
        expect(xml).toContain('<changefreq>weekly</changefreq>');
        expect(xml).toContain('<priority>0.8</priority>');
    });

    it('accepts a string lastModified verbatim', () => {
        const xml = sitemap([
            { url: 'https://example.com/b', lastModified: '2026-06-08' },
        ]);
        expect(xml).toContain('<lastmod>2026-06-08</lastmod>');
    });

    it('escapes XML-significant characters in the url', () => {
        const xml = sitemap([{ url: 'https://example.com/?a=1&b=2<>"\'' }]);
        expect(xml).toContain(
            '<loc>https://example.com/?a=1&amp;b=2&lt;&gt;&quot;&apos;</loc>',
        );
    });
});

describe('robots', () => {
    it('defaults the user-agent to * and emits allow/disallow', () => {
        const txt = robots({ rules: { allow: '/', disallow: '/admin' } });
        expect(txt).toBe('User-agent: *\nAllow: /\nDisallow: /admin');
    });

    it('supports multiple agents and array allow/disallow + crawlDelay', () => {
        const txt = robots({
            rules: {
                userAgent: ['Googlebot', 'Bingbot'],
                allow: ['/', '/public'],
                disallow: ['/admin', '/private'],
                crawlDelay: 10,
            },
        });
        expect(txt).toBe(
            [
                'User-agent: Googlebot',
                'User-agent: Bingbot',
                'Allow: /',
                'Allow: /public',
                'Disallow: /admin',
                'Disallow: /private',
                'Crawl-delay: 10',
            ].join('\n'),
        );
    });

    it('supports an array of rule groups', () => {
        const txt = robots({
            rules: [
                { userAgent: 'Googlebot', allow: '/' },
                { userAgent: 'BadBot', disallow: '/' },
            ],
        });
        expect(txt).toBe(
            'User-agent: Googlebot\nAllow: /\n\nUser-agent: BadBot\nDisallow: /',
        );
    });

    it('appends sitemap(s) and host', () => {
        const txt = robots({
            rules: { userAgent: '*' },
            sitemap: [
                'https://example.com/sitemap.xml',
                'https://example.com/news.xml',
            ],
            host: 'example.com',
        });
        expect(txt).toBe(
            [
                'User-agent: *',
                '',
                'Sitemap: https://example.com/sitemap.xml',
                '',
                'Sitemap: https://example.com/news.xml',
                '',
                'Host: example.com',
            ].join('\n'),
        );
    });

    it('handles a single sitemap string', () => {
        const txt = robots({
            rules: { userAgent: '*' },
            sitemap: 'https://example.com/sitemap.xml',
        });
        expect(txt).toContain('Sitemap: https://example.com/sitemap.xml');
    });
});
