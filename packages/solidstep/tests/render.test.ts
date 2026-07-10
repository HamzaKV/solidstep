import { describe, it, expect, vi, beforeEach } from 'vitest';

// render.ts pulls in the vinxi client manifest and the Solid SSR runtime; both
// are mocked so the orchestration (variant selection, caching, loader execution,
// deferred detection, metadata merge) can be unit-tested in isolation. render.ts
// is intentionally excluded from the coverage gate (it's covered end-to-end by
// the kitchen-sink E2E), so these are behavioral spot-checks, not full coverage.

const renderToString = vi.fn(() => '<rendered/>');
const getCache = vi.fn(async () => null as unknown);
const setCacheWithOptions = vi.fn(async () => undefined);
const shouldCachePage = vi.fn(() => false);
const isPreviewActive = vi.fn(() => false);
const pageCacheKey = vi.fn((_url: URL) => 'page:key');

// Overridable per-src asset lookup — defaults to empty (matching the prior
// behavior for every existing test); the asset-ordering test below swaps in
// a per-src tag so it can assert push order across nodes.
const clientManifestAssets = vi.fn((_src: string): unknown[] => []);
// Per-src artificial resolution delay, so a test can force one node's asset
// fetch to resolve before a DECLARED-earlier sibling's — proving an ordering
// fix enforces declared order rather than happening to pass under the mock's
// default (synchronous, in-order) resolution timing.
const clientManifestDelay: Record<string, number> = {};
const delay = (ms: number) =>
    ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
vi.mock('vinxi/manifest', () => ({
    getManifest: () => ({
        inputs: new Proxy(
            {},
            {
                get: (_t, src: string) => ({
                    assets: async () => {
                        await delay(clientManifestDelay[src] ?? 0);
                        return clientManifestAssets(src);
                    },
                }),
            },
        ),
    }),
}));
vi.mock('solid-js/web', () => ({
    renderToString: (fn: () => unknown) => {
        fn();
        return renderToString();
    },
    createComponent: (c: unknown, props: unknown) => ({ c, props }),
}));
vi.mock('solid-js', () => ({
    Suspense: 'Suspense',
    ErrorBoundary: 'ErrorBoundary',
    createUniqueId: () => 'id',
}));
vi.mock('../utils/deferred', () => ({
    createDeferredResource: (p: unknown) => p,
}));
vi.mock('../utils/cache', () => ({
    getCache: (k: string) => getCache(k),
    setCacheWithOptions: (...a: unknown[]) => setCacheWithOptions(...a),
}));
vi.mock('../utils/page-cache', () => ({
    shouldCachePage: () => shouldCachePage(),
    pageCacheKey: (url: URL) => pageCacheKey(url),
}));
vi.mock('../utils/preview', () => ({
    isPreviewActive: () => isPreviewActive(),
}));
// getCachedModule resolves an Import by calling its `import()`.
vi.mock('../server/route-manifest', () => ({
    getCachedModule: (imp: { import: () => unknown }) => imp.import(),
    getCachedAssets: (manifest: any, src: string) =>
        manifest.inputs[src].assets(),
}));

import { render, routeNeedsStreaming } from '../server/render';
import type { RoutePageHandler } from '../utils/path-router';

const imp = (mod: unknown) => ({
    src: `mod-${Math.random()}`,
    import: () => mod,
});

const req = () => new Request('https://example.com/page');

const baseEntry = (over: Partial<RoutePageHandler> = {}): RoutePageHandler => ({
    type: 'page',
    mainPage: {
        manifestPath: '/',
        page: imp({ default: () => 'PAGE' }),
    },
    layouts: [
        {
            manifestPath: '__root',
            layout: imp({ default: (p: { children: unknown }) => p.children }),
        },
    ],
    ...over,
});

beforeEach(() => {
    renderToString.mockClear();
    getCache.mockReset().mockResolvedValue(null);
    setCacheWithOptions.mockClear();
    shouldCachePage.mockReset().mockReturnValue(false);
    isPreviewActive.mockReset().mockReturnValue(false);
    pageCacheKey.mockClear();
    clientManifestAssets.mockReset().mockReturnValue([]);
    for (const k of Object.keys(clientManifestDelay))
        delete clientManifestDelay[k];
});

describe('render', () => {
    it('renders a plain main page through the layout chain', async () => {
        const result = await render({
            toRender: 'main',
            entry: baseEntry(),
            routeParams: {},
            searchParams: {},
            req: req(),
        });
        expect('rendered' in result && result.rendered).toBe('<rendered/>');
        expect(result.documentAssets).toEqual([]);
        expect(result.loaderData).toEqual({});
        expect('cacheStatus' in result && result.cacheStatus).toBe('miss');
        expect(renderToString).toHaveBeenCalledTimes(1);
    });

    it('returns the cached entry on a page-cache hit without re-rendering', async () => {
        shouldCachePage.mockReturnValue(true);
        getCache.mockResolvedValue({
            rendered: 'CACHED',
            documentMeta: { t: 1 },
            documentAssets: [],
            loaderData: { a: 1 },
        });
        const result = await render({
            toRender: 'main',
            entry: baseEntry(),
            routeParams: {},
            searchParams: {},
            req: req(),
            pageOptions: { cache: { ttl: 1000 } },
        });
        expect('rendered' in result && result.rendered).toBe('CACHED');
        expect('cacheStatus' in result && result.cacheStatus).toBe('hit');
        expect(renderToString).not.toHaveBeenCalled();
    });

    it('reads and writes a separate, preview-prefixed cache key when preview mode is active', async () => {
        shouldCachePage.mockReturnValue(true);
        isPreviewActive.mockReturnValue(true);
        getCache.mockResolvedValue(null);

        await render({
            toRender: 'main',
            entry: baseEntry(),
            routeParams: {},
            searchParams: {},
            req: req(),
            pageOptions: { cache: { ttl: 1000 } },
        });

        // Neither the read nor the write touched the published key -- both
        // used a distinct preview-namespaced key, so a preview render can
        // never see (or pollute) what a non-preview visitor gets served.
        expect(getCache).toHaveBeenCalledWith('preview:page:key');
        expect(getCache).not.toHaveBeenCalledWith('page:key');
        expect(setCacheWithOptions).toHaveBeenCalledWith(
            'preview:page:key',
            expect.anything(),
            expect.anything(),
        );
    });

    it('uses the plain (unprefixed) cache key when preview mode is not active', async () => {
        shouldCachePage.mockReturnValue(true);
        isPreviewActive.mockReturnValue(false);
        getCache.mockResolvedValue(null);

        await render({
            toRender: 'main',
            entry: baseEntry(),
            routeParams: {},
            searchParams: {},
            req: req(),
            pageOptions: { cache: { ttl: 1000 } },
        });

        expect(getCache).toHaveBeenCalledWith('page:key');
        expect(setCacheWithOptions).toHaveBeenCalledWith(
            'page:key',
            expect.anything(),
            expect.anything(),
        );
    });

    it('skips preview/cache-key/cache-read work entirely for a non-cached page', async () => {
        shouldCachePage.mockReturnValue(false);
        await render({
            toRender: 'main',
            entry: baseEntry(),
            routeParams: {},
            searchParams: {},
            req: req(),
        });
        expect(isPreviewActive).not.toHaveBeenCalled();
        expect(pageCacheKey).not.toHaveBeenCalled();
        expect(getCache).not.toHaveBeenCalled();
    });

    it('threads a pre-parsed url through to the cache-key computation instead of re-parsing req.url', async () => {
        shouldCachePage.mockReturnValue(true);
        getCache.mockResolvedValue(null);
        const threadedUrl = new URL('https://example.com/page?threaded=1');
        await render({
            toRender: 'main',
            entry: baseEntry(),
            routeParams: {},
            searchParams: {},
            req: req(), // a different URL than `threadedUrl`
            pageOptions: { cache: { ttl: 1000 } },
            url: threadedUrl,
        });
        expect(pageCacheKey).toHaveBeenCalledWith(threadedUrl);
        expect(getCache).toHaveBeenCalledWith('page:key');
    });

    it('selects the not-found variant', async () => {
        const result = await render({
            toRender: 'not-found',
            entry: baseEntry({
                notFoundPage: {
                    manifestPath: '/not-found',
                    page: imp({ default: () => '404' }),
                },
            }),
            routeParams: {},
            searchParams: {},
            req: req(),
        });
        expect('rendered' in result && result.rendered).toBe('<rendered/>');
        expect(renderToString).toHaveBeenCalledTimes(1);
    });

    it('merges page metadata over layout metadata (page wins)', async () => {
        const result = await render({
            toRender: 'main',
            entry: baseEntry({
                mainPage: {
                    manifestPath: '/',
                    page: imp({ default: () => 'PAGE' }),
                    generateMeta: imp({
                        generateMeta: () => ({ title: 'page' }),
                    }),
                },
                layouts: [
                    {
                        manifestPath: '__root',
                        layout: imp({
                            default: (p: { children: unknown }) => p.children,
                        }),
                        generateMeta: imp({
                            generateMeta: () => ({
                                title: 'layout',
                                base: 'layout',
                            }),
                        }),
                    },
                ],
            }),
            routeParams: {},
            searchParams: {},
            req: req(),
        });
        expect(result.documentMeta).toMatchObject({
            title: 'page',
            base: 'layout',
        });
    });

    it('pushes assets in root-layout-before-page order, even though per-node fetches now run concurrently', async () => {
        clientManifestAssets.mockImplementation((src: string) => [
            { tag: 'link', attrs: { href: src } },
        ]);
        const entry = baseEntry();
        const layoutSrc = `${entry.layouts[0].layout.src}&pick=$css`;
        const pageSrc = `${entry.mainPage.page.src}&pick=$css`;

        const result = await render({
            toRender: 'main',
            entry,
            routeParams: {},
            searchParams: {},
            req: req(),
        });
        const hrefs = result.documentAssets.map(
            (a) => (a as any).attrs.href as string,
        );
        // Layout's own CSS asset is pushed before the page's, mirroring the
        // reduceRight tree order (outer layout resolves and pushes first).
        expect(hrefs).toEqual([layoutSrc, pageSrc]);
    });

    it('pushes group assets in DECLARED order, not resolution order', async () => {
        clientManifestAssets.mockImplementation((src: string) => [
            { tag: 'link', attrs: { href: src } },
        ]);
        const groupAPage = imp({ default: () => 'A' });
        const groupBPage = imp({ default: () => 'B' });
        const groupASrc = `${groupAPage.src}&pick=$css`;
        const groupBSrc = `${groupBPage.src}&pick=$css`;
        // Group "a" is declared FIRST but resolves SLOWER than group "b" —
        // if push order followed resolution order (the bug), "b" would land
        // before "a" despite being declared second.
        clientManifestDelay[groupASrc] = 20;
        clientManifestDelay[groupBSrc] = 0;

        const entry = baseEntry({
            groups: {
                a: { manifestPath: '/group/a', page: groupAPage },
                b: { manifestPath: '/group/b', page: groupBPage },
            },
        });
        const layoutSrc = `${entry.layouts[0].layout.src}&pick=$css`;
        const pageSrc = `${entry.mainPage.page.src}&pick=$css`;

        const result = await render({
            toRender: 'main',
            entry,
            routeParams: {},
            searchParams: {},
            req: req(),
        });
        const hrefs = result.documentAssets.map(
            (a) => (a as any).attrs.href as string,
        );
        expect(hrefs).toEqual([layoutSrc, pageSrc, groupASrc, groupBSrc]);
    });

    it("keeps a boundary group's own/loading/error assets together and in sub-order, alongside a sibling group", async () => {
        clientManifestAssets.mockImplementation((src: string) => [
            { tag: 'link', attrs: { href: src } },
        ]);
        const boundaryPage = imp({ default: () => 'BOUNDARY' });
        const loadingImp = imp({ default: () => 'LOADING' });
        const errorImp = imp({ default: () => 'ERROR' });
        const siblingPage = imp({ default: () => 'SIBLING' });
        const boundarySrc = `${boundaryPage.src}&pick=$css`;
        const loadingSrc = `${loadingImp.src}&pick=$css`;
        const errorSrc = `${errorImp.src}&pick=$css`;
        const siblingSrc = `${siblingPage.src}&pick=$css`;
        // Sibling resolves faster than the boundary group's own/loading/error
        // fetches, to prove sub-order survives the cross-group race too.
        clientManifestDelay[boundarySrc] = 10;
        clientManifestDelay[loadingSrc] = 10;
        clientManifestDelay[errorSrc] = 10;
        clientManifestDelay[siblingSrc] = 0;

        const entry = baseEntry({
            groups: {
                boundary: {
                    manifestPath: '/group/boundary',
                    page: boundaryPage,
                    loadingPage: loadingImp,
                    errorPage: errorImp,
                },
                sibling: { manifestPath: '/group/sibling', page: siblingPage },
            },
        });
        const layoutSrc = `${entry.layouts[0].layout.src}&pick=$css`;
        const pageSrc = `${entry.mainPage.page.src}&pick=$css`;

        const result = await render({
            toRender: 'main',
            entry,
            routeParams: {},
            searchParams: {},
            req: req(),
        });
        const hrefs = result.documentAssets.map(
            (a) => (a as any).attrs.href as string,
        );
        expect(hrefs).toEqual([
            layoutSrc,
            pageSrc,
            boundarySrc,
            loadingSrc,
            errorSrc,
            siblingSrc,
        ]);
    });

    it('returns a deferred result when a layout loader defers', async () => {
        const result = await render({
            toRender: 'main',
            entry: baseEntry({
                layouts: [
                    {
                        manifestPath: '__root',
                        layout: imp({
                            default: (p: { children: unknown }) => p.children,
                        }),
                        loader: imp({
                            loader: {
                                loader: async () => ({ data: { x: 1 } }),
                                options: { type: 'defer' },
                            },
                        }),
                    },
                ],
            }),
            routeParams: {},
            searchParams: {},
            req: req(),
        });
        expect('deferred' in result && result.deferred).toBe(true);
        expect(
            'deferredKeys' in result &&
                (result.deferredKeys as string[]).includes('__root'),
        ).toBe(true);
        // The deferred layout is wrapped in <Suspense>, and — even with no
        // error.tsx — in an <ErrorBoundary> too (defaultBoundaryFallback), so
        // a rejection is contained instead of crashing hydration entirely.
        const composed = (
            result as unknown as { composed: () => { c: unknown } }
        ).composed;
        expect(composed()).toMatchObject({ c: 'ErrorBoundary' });
    });

    it('wraps a deferred layout in <ErrorBoundary> when the route has an error.tsx', async () => {
        const result = await render({
            toRender: 'main',
            entry: baseEntry({
                errorPage: {
                    manifestPath: '/error',
                    page: imp({ default: () => 'ERROR' }),
                },
                layouts: [
                    {
                        manifestPath: '__root',
                        layout: imp({
                            default: (p: { children: unknown }) => p.children,
                        }),
                        loader: imp({
                            loader: {
                                loader: async () => ({ data: {} }),
                                options: { type: 'defer' },
                            },
                        }),
                    },
                ],
            }),
            routeParams: {},
            searchParams: {},
            req: req(),
        });
        const composed = (
            result as unknown as { composed: () => { c: unknown } }
        ).composed;
        expect(composed()).toMatchObject({ c: 'ErrorBoundary' });
    });

    it('returns a deferred result when the page loader defers', async () => {
        const result = await render({
            toRender: 'main',
            entry: baseEntry({
                mainPage: {
                    manifestPath: '/',
                    page: imp({ default: () => 'PAGE' }),
                    loader: imp({
                        loader: {
                            loader: async () => ({ data: { x: 1 } }),
                            options: { type: 'defer' },
                        },
                    }),
                },
            }),
            routeParams: {},
            searchParams: {},
            req: req(),
        });
        expect('deferred' in result && result.deferred).toBe(true);
        expect('composed' in result).toBe(true);
    });
});

describe('routeNeedsStreaming', () => {
    it('returns false for a plain route with no defer/groups', async () => {
        expect(await routeNeedsStreaming(baseEntry())).toBe(false);
    });

    it('returns true when the page loader is deferred', async () => {
        const entry = baseEntry({
            mainPage: {
                manifestPath: '/',
                page: imp({ default: () => 'PAGE' }),
                loader: imp({
                    loader: {
                        loader: async () => ({ data: {} }),
                        options: { type: 'defer' },
                    },
                }),
            },
        });
        expect(await routeNeedsStreaming(entry)).toBe(true);
    });

    it('returns true when a layout loader is deferred', async () => {
        const entry = baseEntry({
            layouts: [
                {
                    manifestPath: '__root',
                    layout: imp({
                        default: (p: { children: unknown }) => p.children,
                    }),
                    loader: imp({
                        loader: {
                            loader: async () => ({ data: {} }),
                            options: { type: 'defer' },
                        },
                    }),
                },
            ],
        });
        expect(await routeNeedsStreaming(entry)).toBe(true);
    });

    it('returns false when a layout loader is sequential (not deferred)', async () => {
        const entry = baseEntry({
            layouts: [
                {
                    manifestPath: '__root',
                    layout: imp({
                        default: (p: { children: unknown }) => p.children,
                    }),
                    loader: imp({
                        loader: {
                            loader: async () => ({ data: {} }),
                            options: {},
                        },
                    }),
                },
            ],
        });
        expect(await routeNeedsStreaming(entry)).toBe(false);
    });
});
