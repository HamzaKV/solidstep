import { describe, it, expect } from 'vitest';
import {
    buildManifest,
    matchInManifest,
    getNotFoundInManifest,
    type ClientFileRoute,
} from '../utils/client-manifest-core';

// A representative kitchen-sink-shaped client route table (the shape
// `ClientRouter` produces: a `/route|/layout|/group|/loading|/error|/not-found`
// path prefix, a `type`, an optional `parent` for groups, and a `$component`).
const cmp = (src: string) => ({
    src,
    import: () => Promise.resolve({ default: () => null }),
});
const ROUTES: ClientFileRoute[] = [
    { path: '/layout', type: 'layout', $component: cmp('layout') },
    { path: '/route', type: 'route', $component: cmp('home') },
    { path: '/route/about', type: 'route', $component: cmp('about') },
    { path: '/route/blog/[slug]', type: 'route', $component: cmp('blog') },
    { path: '/route/docs/[...path]', type: 'route', $component: cmp('docs') },
    { path: '/route/shop/[[...path]]', type: 'route', $component: cmp('shop') },
    { path: '/route/slow', type: 'route', $component: cmp('slow') },
    { path: '/loading/slow', type: 'loading', $component: cmp('slowloading') },
    { path: '/route/boom', type: 'route', $component: cmp('boom') },
    { path: '/error/boom', type: 'error', $component: cmp('boomerror') },
    { path: '/layout/dashboard', type: 'layout', $component: cmp('dashlay') },
    { path: '/route/dashboard', type: 'route', $component: cmp('dash') },
    {
        path: '/group/dashboard/@analytics',
        type: 'group',
        parent: '/dashboard',
        $component: cmp('analytics'),
    },
    {
        path: '/loading/dashboard/@analytics',
        type: 'loading',
        $component: cmp('analyticsloading'),
    },
    {
        path: '/group/dashboard/@team',
        type: 'group',
        parent: '/dashboard',
        $component: cmp('team'),
    },
    {
        path: '/error/dashboard/@team',
        type: 'error',
        $component: cmp('teamerror'),
    },
    { path: '/not-found', type: 'not-found', $component: cmp('nf') },
];

const trie = buildManifest(ROUTES);
const match = (p: string) => matchInManifest(trie, p);

describe('client manifest matching', () => {
    it('matches the root page and its layout chain', () => {
        const m = match('/');
        expect(m?.handler.mainPage.manifestPath).toBe('/route');
        expect(m?.handler.layouts.map((l) => l.manifestPath)).toEqual([
            '/layout',
        ]);
    });

    it('matches a static nested route', () => {
        expect(match('/about')?.handler.mainPage.manifestPath).toBe(
            '/route/about',
        );
    });

    it('extracts a dynamic param', () => {
        const m = match('/blog/hello-world');
        expect(m?.handler.mainPage.manifestPath).toBe('/route/blog/[slug]');
        expect(m?.params).toEqual({ slug: 'hello-world' });
    });

    it('extracts a catch-all param as an array', () => {
        const m = match('/docs/a/b/c');
        expect(m?.handler.mainPage.manifestPath).toBe('/route/docs/[...path]');
        expect(m?.params).toEqual({ path: ['a', 'b', 'c'] });
    });

    it('matches an optional catch-all at its root (empty array)', () => {
        const m = match('/shop');
        expect(m?.handler.mainPage.manifestPath).toBe(
            '/route/shop/[[...path]]',
        );
        expect(m?.params).toEqual({ path: [] });
    });

    it('matches an optional catch-all with segments', () => {
        expect(match('/shop/electronics/phones')?.params).toEqual({
            path: ['electronics', 'phones'],
        });
    });

    it('attaches a route-level loading page', () => {
        expect(match('/slow')?.handler.loadingPage?.manifestPath).toBe(
            '/loading/slow',
        );
    });

    it('attaches a route-level error page', () => {
        expect(match('/boom')?.handler.errorPage?.manifestPath).toBe(
            '/error/boom',
        );
    });

    it('attaches nested layouts and parallel-route groups with their boundaries', () => {
        const m = match('/dashboard');
        expect(m?.handler.layouts.map((l) => l.manifestPath)).toEqual([
            '/layout',
            '/layout/dashboard',
        ]);
        const groups = m?.handler.groups ?? {};
        expect(Object.keys(groups).sort()).toEqual(['@analytics', '@team']);
        expect(groups['@analytics'].loadingPage?.src).toBe('analyticsloading');
        expect(groups['@team'].errorPage?.src).toBe('teamerror');
    });

    it('returns null for an unmatched path', () => {
        expect(match('/does/not/exist')).toBeNull();
    });

    it('exposes the root not-found handler', () => {
        expect(getNotFoundInManifest(trie)?.manifestPath).toBe('/not-found');
    });

    it('returns undefined when the trie has no root page', () => {
        expect(getNotFoundInManifest(buildManifest([]))).toBeUndefined();
    });

    it('attaches a parentless group to the root and skips an unnamed group', () => {
        const t = buildManifest([
            { path: '/route', type: 'route', $component: cmp('home') },
            // No `parent` → falls back to the root path ('/').
            { path: '/group/@side', type: 'group', $component: cmp('side') },
            // Trailing slash → empty group name → skipped.
            { path: '/group/', type: 'group', $component: cmp('noname') },
        ]);
        const m = matchInManifest(t, '/');
        expect(m?.handler.groups?.['@side']?.page.src).toBe('side');
        expect(Object.keys(m?.handler.groups ?? {})).toEqual(['@side']);
    });
});
