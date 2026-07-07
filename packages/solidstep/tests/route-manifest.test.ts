import { describe, it, expect, vi, beforeEach } from 'vitest';

// route-manifest.ts turns vinxi's flat `fileRoutes` list (one entry per
// convention file: page/layout/loading/error/group/metadata/route) into the
// route trie `server.ts` matches against, plus the metadata-file URL map.
// It is excluded from the coverage gate (covered by e2e); these pin its
// current behavior through the public functions this file exports.

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

    it('skips a dynamic route with no options (defaults to dynamic render, not prerendered)', async () => {
        fileRoutes.push(page('/about', 'app/about/page.tsx'));
        await rebuildCachedManifest();

        const targets = await collectPrerenderTargets();

        expect(targets).toEqual([]);
    });
});
