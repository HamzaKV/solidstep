import { describe, it, expect, vi, beforeEach } from 'vitest';

// route-manifest.ts turns vinxi's flat `fileRoutes` list (one entry per
// convention file: page/layout/loading/error/group/metadata/route) into the
// route trie `server.ts` matches against, plus the metadata-file URL map.
// These pin its current behavior through the public functions this file
// exports.

vi.mock('vinxi/manifest', () => ({
    getManifest: () => ({ marker: 'client-manifest' }),
}));

import fileRoutes from 'vinxi/routes';
import {
    createRouteManifest,
    getCachedModule,
    ensureRouteManifest,
    ensureClientManifest,
    collectPrerenderTargets,
    setRouteManifest,
    getMetadataManifest,
} from '../server/route-manifest';
import { matchRoute } from '../utils/path-router';

// `ensureRouteManifest` (and, through it, `collectPrerenderTargets`) caches the
// manifest in a module-level singleton, only rebuilt via `setRouteManifest`.
// Rebuild it from the current `fileRoutes` fixture before each test that reads
// through that cache, so tests don't see a manifest built by an earlier test.
const rebuildCachedManifest = async () => {
    const manifest = await createRouteManifest();
    setRouteManifest(manifest.rootNode, manifest.metadataMap);
};

const page = (
    path: string,
    src: string,
    extra: Record<string, unknown> = {},
) => ({
    type: 'route',
    path: `/route${path}`,
    $handler: { src, pick: [] },
    $component: { src, import: async () => ({ default: () => src }) },
    ...extra,
});

const layout = (path: string, src: string) => ({
    type: 'layout',
    path: `/layout${path}`,
    $component: { src, import: async () => ({ default: () => 'layout' }) },
});

const apiRoute = (path: string, src: string) => ({
    type: 'route',
    path: `/route${path}`,
    $handler: {
        src,
        import: async () => ({ GET: async () => new Response('ok') }),
    },
});

const metadataFile = (name: string, src: string) => ({
    type: 'metadata',
    metaName: name,
    path: `/metadata/${name}`,
    $handler: { src, import: async () => ({ default: () => 'meta' }) },
});

const group = (parent: string, slotPath: string, src: string) => ({
    type: 'group',
    parent,
    path: `/group${slotPath}`,
    $handler: { src, pick: [] },
    $component: { src, import: async () => ({ default: () => 'slot' }) },
    $loader: { src, import: async () => ({ loader: {} }) },
});

const loadingFile = (path: string, src: string) => ({
    type: 'loading',
    path: `/loading${path}`,
    $component: { src, import: async () => ({ default: () => 'loading' }) },
});

const errorFile = (path: string, src: string) => ({
    type: 'error',
    path: `/error${path}`,
    $component: { src, import: async () => ({ default: () => 'error' }) },
});

const notFoundFile = (src: string) => ({
    type: 'not-found',
    path: '/not-found/',
    $component: { src, import: async () => ({ default: () => 'not-found' }) },
});

beforeEach(() => {
    fileRoutes.length = 0;
});

describe('createRouteManifest', () => {
    it('builds a page entry reachable via matchRoute, with its ancestor layouts attached in root-to-leaf order', async () => {
        fileRoutes.push(
            layout('/', 'app/layout.tsx'),
            layout('/dashboard', 'app/dashboard/layout.tsx'),
            page('/dashboard', 'app/dashboard/page.tsx'),
        );

        const { rootNode } = await createRouteManifest();
        const match = matchRoute(rootNode, '/dashboard');

        expect(match).not.toBeNull();
        expect(match!.handler!.type).toBe('page');
        const handler = match!.handler as any;
        expect(
            handler.layouts.map(
                (l: { manifestPath: string }) => l.manifestPath,
            ),
        ).toEqual(['/layout/', '/layout/dashboard']);
    });

    it('attaches an @group parallel-route slot (with its own loading/error boundary) to the page', async () => {
        fileRoutes.push(
            page('/dashboard', 'app/dashboard/page.tsx'),
            group(
                '/dashboard',
                '/dashboard/@sidebar',
                'app/dashboard/@sidebar/page.tsx',
            ),
            loadingFile(
                '/dashboard/@sidebar',
                'app/dashboard/@sidebar/loading.tsx',
            ),
            errorFile(
                '/dashboard/@sidebar',
                'app/dashboard/@sidebar/error.tsx',
            ),
        );

        const { rootNode } = await createRouteManifest();
        const match = matchRoute(rootNode, '/dashboard');
        const handler = match!.handler as any;

        expect(handler.groups['@sidebar']).toBeDefined();
        expect(handler.groups['@sidebar'].manifestPath).toBe(
            '/group/dashboard/@sidebar',
        );
        expect(handler.groups['@sidebar'].loadingPage).toBeDefined();
        expect(handler.groups['@sidebar'].errorPage).toBeDefined();
    });

    it('attaches the root not-found page to the root route only', async () => {
        fileRoutes.push(
            page('/', 'app/page.tsx'),
            page('/about', 'app/about/page.tsx'),
            notFoundFile('app/not-found.tsx'),
        );

        const { rootNode } = await createRouteManifest();
        const root = matchRoute(rootNode, '/')!.handler as any;
        const about = matchRoute(rootNode, '/about')!.handler as any;

        expect(root.notFoundPage).toBeDefined();
        expect(root.notFoundPage.manifestPath).toBe('/not-found/');
        expect(about.notFoundPage).toBeUndefined();
    });

    it('classifies a route.ts file as an API route, distinct from a page', async () => {
        fileRoutes.push(apiRoute('/api/health', 'app/api/health/route.ts'));

        const { rootNode } = await createRouteManifest();
        const match = matchRoute(rootNode, '/api/health');

        expect(match!.handler!.type).toBe('route');
    });

    it('registers a metadata convention file at its conventional URL', async () => {
        fileRoutes.push(metadataFile('robots', 'app/robots.ts'));

        const { metadataMap } = await createRouteManifest();

        expect(metadataMap.get('/robots.txt')).toMatchObject({
            contentType: 'text/plain; charset=utf-8',
        });
    });
});

describe('ensureRouteManifest / ensureClientManifest', () => {
    it('builds the route manifest once and caches it across calls', async () => {
        // Force a rebuild-then-cache cycle regardless of manifest state left
        // by earlier tests, matching the real "first request builds it" flow.
        setRouteManifest(null as any, null as any);
        fileRoutes.push(page('/about', 'app/about/page.tsx'));

        const first = await ensureRouteManifest();
        const second = await ensureRouteManifest();

        expect(second).toBe(first);
    });

    it('resolves the vinxi client manifest once and caches it', () => {
        const first = ensureClientManifest();
        const second = ensureClientManifest();

        expect(second).toBe(first);
    });

    it('exposes the metadata map populated by the last (re)build', async () => {
        fileRoutes.push(metadataFile('sitemap', 'app/sitemap.ts'));
        await rebuildCachedManifest();

        expect(getMetadataManifest()?.get('/sitemap.xml')).toBeDefined();
    });
});

describe('getCachedModule', () => {
    it('resolves the import and returns its module', async () => {
        const mod = { default: () => 'hi' };
        const result = await getCachedModule<typeof mod>({
            src: 'x',
            import: async () => mod,
        } as any);

        expect(result).toBe(mod);
    });
});

describe('collectPrerenderTargets', () => {
    it('expands a static route with generateStaticParams into concrete targets', async () => {
        fileRoutes.push(
            page('/blog/[slug]', 'app/blog/[slug]/page.tsx', {
                $options: {
                    src: 'opts',
                    import: async () => ({ options: { render: 'static' } }),
                },
                $generateStaticParams: {
                    src: 'gsp',
                    import: async () => ({
                        generateStaticParams: async () => [
                            { slug: 'hello' },
                            { slug: 'world' },
                        ],
                    }),
                },
            }),
        );
        await rebuildCachedManifest();

        const targets = await collectPrerenderTargets();

        expect(targets).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    pathname: '/blog/hello',
                    render: 'static',
                }),
                expect.objectContaining({
                    pathname: '/blog/world',
                    render: 'static',
                }),
            ]),
        );
    });

    it('expands a static catch-all route with generateStaticParams', async () => {
        fileRoutes.push(
            page('/docs/[...path]', 'app/docs/[...path]/page.tsx', {
                $options: {
                    src: 'opts2',
                    import: async () => ({ options: { render: 'static' } }),
                },
                $generateStaticParams: {
                    src: 'gsp2',
                    import: async () => ({
                        generateStaticParams: async () => [
                            { path: ['a', 'b'] },
                        ],
                    }),
                },
            }),
        );
        await rebuildCachedManifest();

        const targets = await collectPrerenderTargets();

        expect(targets).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ pathname: '/docs/a/b' }),
            ]),
        );
    });

    it('warns and skips a dynamic static route with no generateStaticParams', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        fileRoutes.push(
            page('/blog/[slug]', 'app/blog/[slug]/page.tsx', {
                $options: {
                    src: 'opts3',
                    import: async () => ({ options: { render: 'static' } }),
                },
            }),
        );
        await rebuildCachedManifest();

        const targets = await collectPrerenderTargets();

        expect(targets).toEqual([]);
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('requires generateStaticParams'),
        );
        warnSpy.mockRestore();
    });

    it('skips a dynamic route with no options (defaults to dynamic render, not prerendered)', async () => {
        fileRoutes.push(page('/about', 'app/about/page.tsx'));
        await rebuildCachedManifest();

        const targets = await collectPrerenderTargets();

        expect(targets).toEqual([]);
    });
});
