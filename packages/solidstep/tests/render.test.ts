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

vi.mock('vinxi/manifest', () => ({
    // Any input src resolves to a node whose assets() is empty.
    getManifest: () => ({
        inputs: new Proxy({}, { get: () => ({ assets: async () => [] }) }),
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
    pageCacheKey: () => 'page:key',
}));
vi.mock('../utils/preview', () => ({
    isPreviewActive: () => isPreviewActive(),
}));
// getCachedModule resolves an Import by calling its `import()`.
vi.mock('../server/route-manifest', () => ({
    getCachedModule: (imp: { import: () => unknown }) => imp.import(),
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

    it('skips the page-cache read (but still writes) when preview mode is active', async () => {
        shouldCachePage.mockReturnValue(true);
        isPreviewActive.mockReturnValue(true);
        getCache.mockResolvedValue({
            rendered: 'CACHED',
            documentMeta: {},
            documentAssets: [],
            loaderData: {},
        });

        const result = await render({
            toRender: 'main',
            entry: baseEntry(),
            routeParams: {},
            searchParams: {},
            req: req(),
            pageOptions: { cache: { ttl: 1000 } },
        });

        // A real (non-cached) render happened despite a cache entry existing.
        expect(renderToString).toHaveBeenCalledTimes(1);
        expect('rendered' in result && result.rendered).toBe('<rendered/>');
        // The write path is untouched by preview mode -- still caches the
        // fresh render for the next non-preview visitor.
        expect(setCacheWithOptions).toHaveBeenCalled();
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
        // The deferred layout is wrapped in <Suspense> (mocked as the plain
        // string 'Suspense' by createComponent's mock).
        const composed = (
            result as unknown as { composed: () => { c: unknown } }
        ).composed;
        expect(composed()).toMatchObject({ c: 'Suspense' });
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
