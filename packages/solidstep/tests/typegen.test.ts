import { describe, it, expect } from 'vitest';
import { pageFileToRoute, generateRouteTypes } from '../utils/typegen';

describe('pageFileToRoute', () => {
    it('maps the root page', () => {
        expect(pageFileToRoute('page.tsx')).toEqual({
            id: '/',
            hrefs: ["'/'"],
            params: [],
        });
    });

    it('maps a static nested page', () => {
        expect(pageFileToRoute('about/page.tsx')?.id).toBe('/about');
        expect(pageFileToRoute('about/page.tsx')?.hrefs).toEqual(["'/about'"]);
    });

    it('maps a dynamic [slug] segment to a template href + string param', () => {
        const r = pageFileToRoute('blog/[slug]/page.tsx');
        expect(r?.id).toBe('/blog/[slug]');
        expect(r?.hrefs).toEqual(['`/blog/${string}`']);
        expect(r?.params).toEqual([['slug', 'string']]);
    });

    it('maps a catch-all [...path] to a string[] param', () => {
        const r = pageFileToRoute('docs/[...path]/page.tsx');
        expect(r?.id).toBe('/docs/[...path]');
        expect(r?.params).toEqual([['path', 'string[]']]);
    });

    it('maps an optional catch-all to both the parent and child hrefs', () => {
        const r = pageFileToRoute('shop/[[...path]]/page.tsx');
        expect(r?.id).toBe('/shop/[[...path]]');
        expect(r?.hrefs).toEqual(['`/shop/${string}`', "'/shop'"]);
        expect(r?.params).toEqual([['path', 'string[]']]);
    });

    it('drops (group) segments from the URL but keeps the route', () => {
        expect(pageFileToRoute('(marketing)/about/page.tsx')?.id).toBe(
            '/about',
        );
    });

    it('ignores @slot and _private dirs (not standalone routes)', () => {
        expect(pageFileToRoute('dashboard/@analytics/page.tsx')).toBeNull();
        expect(pageFileToRoute('_lib/helpers/page.tsx')).toBeNull();
    });

    it('ignores non-page files', () => {
        expect(pageFileToRoute('api/health/route.ts')).toBeNull();
        expect(pageFileToRoute('blog/[slug]/loading.tsx')).toBeNull();
    });
});

describe('generateRouteTypes', () => {
    it('emits a Register augmentation with sorted routes, hrefs, and params', () => {
        const out = generateRouteTypes([
            'page.tsx',
            'about/page.tsx',
            'blog/[slug]/page.tsx',
            'dashboard/@analytics/page.tsx', // ignored (slot)
            'api/health/route.ts', // ignored (not a page)
        ]);
        expect(out).toContain("declare module 'solidstep/router'");
        expect(out).toContain('interface Register');
        expect(out).toContain("routes: '/' | '/about' | '/blog/[slug]';");
        expect(out).toContain("hrefs: '/' | '/about' | `/blog/${string}`;");
        expect(out).toContain("'/blog/[slug]': { slug: string };");
        expect(out).toContain("'/about': {};");
        expect(out).toContain('export {};');
    });

    it('emits `never` unions when there are no page routes', () => {
        const out = generateRouteTypes(['api/health/route.ts']);
        expect(out).toContain('routes: never;');
        expect(out).toContain('hrefs: never;');
    });
});
