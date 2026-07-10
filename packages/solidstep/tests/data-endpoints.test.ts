import { describe, it, expect, vi, beforeEach } from 'vitest';

// serveRouteData/serveHoleData encode redirects/errors/not-found into a
// serialized envelope (rather than HTTP status) for the soft-nav client.
// seroval is mocked to an identity so the envelope object can be inspected
// directly. These are behavioral characterization tests through the public
// entry points.

const matchRoute = vi.fn();
const runSequentialLoader = vi.fn(async () => ({}));
const getCachedLoaderData = vi.fn(async () => ({}));
const logger = vi.hoisted(() => ({ error: vi.fn() }));

vi.mock('seroval', () => ({ serialize: (v: unknown) => v }));
vi.mock('../utils/serialize', () => ({ SEROVAL_PLUGINS: [] }));
vi.mock('../server/route-manifest', () => ({
    ensureRouteManifest: async () => ({}),
    getCachedModule: async (imp: { import: () => unknown }) => imp.import(),
}));
vi.mock('../utils/path-router', () => ({
    matchRoute: (...a: unknown[]) => matchRoute(...a),
    parseSearchParams: () => ({}),
}));
vi.mock('../utils/loader-error', () => ({
    runSequentialLoader: (...a: unknown[]) => runSequentialLoader(...a),
}));
vi.mock('../utils/loader-cache', () => ({
    getCachedLoaderData: (...a: unknown[]) => getCachedLoaderData(...a),
}));
vi.mock('../utils/logger', () => ({ logger }));

import { serveRouteData, serveHoleData } from '../server/data-endpoints';
import { RedirectError } from '../utils/redirect';

const req = (url = 'route') =>
    new Request(`https://example.com/__route?url=${url}`);

const holeReq = (params: string) =>
    new Request(`https://example.com/__loader?${params}`);

beforeEach(() => {
    matchRoute.mockReset();
    runSequentialLoader.mockReset().mockResolvedValue({});
    getCachedLoaderData.mockReset().mockResolvedValue({ n: 1 });
    logger.error.mockClear();
});

describe('serveHoleData', () => {
    it('returns null when manifest or url params are missing', async () => {
        expect(await serveHoleData(holeReq('url=/p'))).toBeNull();
        expect(await serveHoleData(holeReq('manifest=/p'))).toBeNull();
    });

    it('returns null when no route matches the target url', async () => {
        matchRoute.mockReturnValue(undefined);
        const body = await serveHoleData(holeReq('manifest=/p&url=/p'));
        expect(body).toBeNull();
    });

    it('returns null when the match is not a page (e.g. an API route)', async () => {
        matchRoute.mockReturnValue({ handler: { type: 'route' }, params: {} });
        const body = await serveHoleData(holeReq('manifest=/p&url=/p'));
        expect(body).toBeNull();
    });

    it('yields a per-item error when a manifest does not match the page, any layout, or group', async () => {
        matchRoute.mockReturnValue({
            handler: {
                type: 'page',
                mainPage: { manifestPath: '/p' },
                layouts: [],
                groups: {},
            },
            params: {},
        });
        const body = (await serveHoleData(
            holeReq('manifest=/unknown&url=/p'),
        )) as unknown as { results: { manifest: string; error?: string }[] };
        expect(body.results).toHaveLength(1);
        expect(body.results[0].error).toBeTruthy();
    });

    it('yields a per-item error when the resolved loader import has no loader export', async () => {
        matchRoute.mockReturnValue({
            handler: {
                type: 'page',
                mainPage: {
                    manifestPath: '/p',
                    loader: { src: 'l', import: async () => ({}) },
                },
                layouts: [],
                groups: {},
            },
            params: {},
        });
        const body = (await serveHoleData(
            holeReq('manifest=/p&url=/p'),
        )) as unknown as { results: { manifest: string; error?: string }[] };
        expect(body.results).toHaveLength(1);
        expect(body.results[0].error).toBeTruthy();
    });

    it('yields a per-item error when the addressed loader is not a deferred one', async () => {
        matchRoute.mockReturnValue({
            handler: {
                type: 'page',
                mainPage: {
                    manifestPath: '/p',
                    // A regular (non-defer) loader: never a hole, so the
                    // endpoint must refuse to run it.
                    loader: { src: 'l', import: async () => ({ loader: {} }) },
                },
                layouts: [],
                groups: {},
            },
            params: {},
        });
        const body = (await serveHoleData(
            holeReq('manifest=/p&url=/p'),
        )) as unknown as { results: { manifest: string; error?: string }[] };
        expect(body.results).toHaveLength(1);
        expect(body.results[0].error).toBeTruthy();
        expect(getCachedLoaderData).not.toHaveBeenCalled();
    });

    it("resolves the page's own deferred loader", async () => {
        matchRoute.mockReturnValue({
            handler: {
                type: 'page',
                mainPage: {
                    manifestPath: '/p',
                    loader: {
                        src: 'l',
                        import: async () => ({
                            loader: { options: { type: 'defer' } },
                        }),
                    },
                },
                layouts: [],
                groups: {},
            },
            params: {},
        });
        const body = (await serveHoleData(
            holeReq('manifest=/p&url=/p'),
        )) as unknown as { results: { manifest: string; data: unknown }[] };
        expect(body.results).toEqual([{ manifest: '/p', data: { n: 1 } }]);
    });

    it("resolves a layout's deferred loader when manifest matches a layout", async () => {
        matchRoute.mockReturnValue({
            handler: {
                type: 'page',
                mainPage: { manifestPath: '/p' },
                layouts: [
                    {
                        manifestPath: '/layout',
                        loader: {
                            src: 'l',
                            import: async () => ({
                                loader: { options: { type: 'defer' } },
                            }),
                        },
                    },
                ],
                groups: {},
            },
            params: {},
        });
        const body = (await serveHoleData(
            holeReq('manifest=/layout&url=/p'),
        )) as unknown as { results: { manifest: string; data: unknown }[] };
        expect(body.results).toEqual([{ manifest: '/layout', data: { n: 1 } }]);
    });

    it("resolves a group's deferred loader when manifest matches a parallel-route slot", async () => {
        matchRoute.mockReturnValue({
            handler: {
                type: 'page',
                mainPage: { manifestPath: '/p' },
                layouts: [],
                groups: {
                    sidebar: {
                        manifestPath: '/group/sidebar',
                        loader: {
                            src: 'l',
                            import: async () => ({
                                loader: { options: { type: 'defer' } },
                            }),
                        },
                    },
                },
            },
            params: {},
        });
        const body = (await serveHoleData(
            holeReq('manifest=/group/sidebar&url=/p'),
        )) as unknown as { results: { manifest: string; data: unknown }[] };
        expect(body.results).toEqual([
            { manifest: '/group/sidebar', data: { n: 1 } },
        ]);
    });

    it("resolves a boundary group's NON-deferred loader (PPR emits those as holes too)", async () => {
        matchRoute.mockReturnValue({
            handler: {
                type: 'page',
                mainPage: { manifestPath: '/p' },
                layouts: [],
                groups: {
                    sidebar: {
                        manifestPath: '/group/sidebar',
                        loader: {
                            src: 'l',
                            // Regular (non-defer) loader: under PPR the render
                            // engine still reports boundary groups as holes,
                            // so the endpoint must serve them.
                            import: async () => ({ loader: {} }),
                        },
                    },
                },
            },
            params: {},
        });
        const body = (await serveHoleData(
            holeReq('manifest=/group/sidebar&url=/p'),
        )) as unknown as { results: { manifest: string; data: unknown }[] };
        expect(body.results).toEqual([
            { manifest: '/group/sidebar', data: { n: 1 } },
        ]);
    });

    it('encodes an error envelope (not a rejection) when the deferred loader throws', async () => {
        matchRoute.mockReturnValue({
            handler: {
                type: 'page',
                mainPage: {
                    manifestPath: '/p',
                    loader: {
                        src: 'l',
                        import: async () => ({
                            loader: { options: { type: 'defer' } },
                        }),
                    },
                },
                layouts: [],
                groups: {},
            },
            params: {},
        });
        getCachedLoaderData.mockRejectedValue(new Error('hole exploded'));

        const body = (await serveHoleData(
            holeReq('manifest=/p&url=/p'),
        )) as unknown as { results: { manifest: string; error: string }[] };

        // import.meta.env.DEV is true under vitest -> real message.
        expect(body.results).toEqual([
            { manifest: '/p', error: 'hole exploded' },
        ]);
    });

    it('batches multiple manifests into one response, resolving each independently', async () => {
        matchRoute.mockReturnValue({
            handler: {
                type: 'page',
                mainPage: {
                    manifestPath: '/p',
                    loader: {
                        src: 'l',
                        import: async () => ({
                            loader: { options: { type: 'defer' } },
                        }),
                    },
                },
                layouts: [
                    {
                        manifestPath: '/layout',
                        loader: {
                            src: 'll',
                            import: async () => ({
                                loader: { options: { type: 'defer' } },
                            }),
                        },
                    },
                ],
                groups: {},
            },
            params: {},
        });
        getCachedLoaderData.mockImplementation(
            async (_loaderFn: unknown, manifestPath: string) => ({
                from: manifestPath,
            }),
        );

        const body = (await serveHoleData(
            holeReq('manifest=/p&manifest=/layout&url=/p'),
        )) as unknown as {
            results: { manifest: string; data: unknown }[];
        };

        // matchRoute (and thus the route-tree walk) runs ONCE for the whole
        // batch, not once per manifest — the entire point of batching.
        expect(matchRoute).toHaveBeenCalledTimes(1);
        const byManifest = Object.fromEntries(
            body.results.map((r) => [r.manifest, r.data]),
        );
        expect(byManifest['/p']).toEqual({ from: '/p' });
        expect(byManifest['/layout']).toEqual({ from: '/layout' });
    });

    it('a bad manifest in a batch yields a per-item error, without failing sibling manifests', async () => {
        matchRoute.mockReturnValue({
            handler: {
                type: 'page',
                mainPage: {
                    manifestPath: '/p',
                    loader: {
                        src: 'l',
                        import: async () => ({
                            loader: { options: { type: 'defer' } },
                        }),
                    },
                },
                layouts: [],
                groups: {},
            },
            params: {},
        });

        const body = (await serveHoleData(
            holeReq('manifest=/p&manifest=/unknown&url=/p'),
        )) as unknown as {
            results: { manifest: string; data?: unknown; error?: string }[];
        };

        const byManifest = Object.fromEntries(
            body.results.map((r) => [r.manifest, r]),
        );
        expect(byManifest['/p'].data).toEqual({ n: 1 });
        expect(byManifest['/unknown'].error).toBeTruthy();
        expect(byManifest['/unknown'].data).toBeUndefined();
    });

    it('dedupes a manifest requested more than once in the same batch', async () => {
        matchRoute.mockReturnValue({
            handler: {
                type: 'page',
                mainPage: {
                    manifestPath: '/p',
                    loader: {
                        src: 'l',
                        import: async () => ({
                            loader: { options: { type: 'defer' } },
                        }),
                    },
                },
                layouts: [],
                groups: {},
            },
            params: {},
        });

        const body = (await serveHoleData(
            holeReq('manifest=/p&manifest=/p&url=/p'),
        )) as unknown as { results: { manifest: string }[] };

        expect(body.results).toHaveLength(1);
        expect(getCachedLoaderData).toHaveBeenCalledTimes(1);
    });

    it('rejects a batch exceeding the manifest cap with 400 (null), even when manifest[0] would otherwise resolve', async () => {
        matchRoute.mockReturnValue({
            handler: {
                type: 'page',
                mainPage: {
                    manifestPath: '/p',
                    // A genuinely resolvable deferred loader at the FIRST
                    // requested manifest -- proves the whole batch is
                    // rejected for exceeding the cap, not incidentally
                    // returning null because nothing in the batch matched.
                    loader: {
                        src: 'l',
                        import: async () => ({
                            loader: { options: { type: 'defer' } },
                        }),
                    },
                },
                layouts: [],
                groups: {},
            },
            params: {},
        });
        const manyManifests = ['manifest=/p']
            .concat(Array.from({ length: 65 }, (_, i) => `manifest=/m${i}`))
            .join('&');

        const body = await serveHoleData(holeReq(`${manyManifests}&url=/p`));

        expect(body).toBeNull();
    });
});

describe('serveRouteData', () => {
    it('returns null when the url param is missing', async () => {
        const body = await serveRouteData(new Request('https://example.com/x'));
        expect(body).toBeNull();
    });

    it('encodes a not-found envelope when no route matches', async () => {
        matchRoute.mockReturnValue(undefined);
        const body = (await serveRouteData(req())) as unknown as {
            type: string;
        };
        expect(body.type).toBe('not-found');
    });

    it('encodes a route envelope for an API route match', async () => {
        matchRoute.mockReturnValue({ handler: { type: 'route' }, params: {} });
        const body = (await serveRouteData(req())) as unknown as {
            type: string;
        };
        expect(body.type).toBe('route');
    });

    it('encodes a redirect envelope when a page loader redirects', async () => {
        matchRoute.mockReturnValue({
            handler: {
                type: 'page',
                mainPage: {
                    manifestPath: '/p',
                    loader: { src: 'l', import: () => ({ loader: {} }) },
                },
                layouts: [],
            },
            params: {},
        });
        runSequentialLoader.mockRejectedValue(new RedirectError('/login'));
        const body = (await serveRouteData(req())) as unknown as {
            type: string;
            location: string;
        };
        expect(body.type).toBe('redirect');
        expect(body.location).toBe('/login');
    });

    it('resolves loader data + merged meta for a successful page render', async () => {
        matchRoute.mockReturnValue({
            handler: {
                type: 'page',
                mainPage: {
                    manifestPath: '/p',
                    loader: { src: 'l', import: async () => ({ loader: {} }) },
                    generateMeta: {
                        src: 'm',
                        import: async () => ({
                            generateMeta: () => ({ title: 'Page' }),
                        }),
                    },
                },
                layouts: [
                    {
                        manifestPath: '/layout',
                        generateMeta: {
                            src: 'lm',
                            import: async () => ({
                                generateMeta: () => ({ layoutMeta: true }),
                            }),
                        },
                    },
                ],
            },
            params: {},
        });
        runSequentialLoader.mockResolvedValue({ n: 42 });

        const body = (await serveRouteData(req())) as unknown as {
            type: string;
            loaderData: Record<string, unknown>;
            meta: Record<string, unknown>;
        };

        expect(body.type).toBe('page');
        expect(body.loaderData['/p']).toEqual({ n: 42 });
        expect(body.meta).toEqual({ layoutMeta: true, title: 'Page' });
    });

    it("resolves a parallel-route group's loader alongside the page", async () => {
        matchRoute.mockReturnValue({
            handler: {
                type: 'page',
                mainPage: {
                    manifestPath: '/p',
                    loader: { src: 'l', import: async () => ({ loader: {} }) },
                },
                layouts: [],
                groups: {
                    sidebar: {
                        manifestPath: '/group/sidebar',
                        loader: {
                            src: 'gl',
                            import: async () => ({ loader: {} }),
                        },
                    },
                },
            },
            params: {},
        });
        runSequentialLoader.mockImplementation(
            async (_loaderFn, manifestPath) => ({ from: manifestPath }),
        );

        const body = (await serveRouteData(req())) as unknown as {
            loaderData: Record<string, unknown>;
        };

        expect(body.loaderData['/group/sidebar']).toEqual({
            from: '/group/sidebar',
        });
    });

    it('reports a deferred loader in deferredKeys instead of resolving it', async () => {
        matchRoute.mockReturnValue({
            handler: {
                type: 'page',
                mainPage: {
                    manifestPath: '/p',
                    loader: {
                        src: 'l',
                        import: async () => ({
                            loader: { options: { type: 'defer' } },
                        }),
                    },
                },
                layouts: [],
            },
            params: {},
        });

        const body = (await serveRouteData(req())) as unknown as {
            deferredKeys: string[];
            loaderData: Record<string, unknown>;
        };

        expect(body.deferredKeys).toEqual(['/p']);
        expect(body.loaderData['/p']).toBeUndefined();
        expect(runSequentialLoader).not.toHaveBeenCalled();
    });

    it('encodes an error envelope with the real message in DEV when an errorPage exists', async () => {
        matchRoute.mockReturnValue({
            handler: {
                type: 'page',
                mainPage: {
                    manifestPath: '/p',
                    loader: { src: 'l', import: async () => ({ loader: {} }) },
                },
                layouts: [],
                errorPage: { manifestPath: '/p/error' },
            },
            params: {},
        });
        runSequentialLoader.mockRejectedValue(new Error('loader exploded'));

        const body = (await serveRouteData(req())) as unknown as {
            type: string;
            message: string;
            errorPageManifest: string;
        };

        expect(body.type).toBe('error');
        expect(body.errorPageManifest).toBe('/p/error');
        // import.meta.env.DEV is true under vitest's default mode.
        expect(body.message).toBe('loader exploded');
        expect(logger.error).not.toHaveBeenCalled();
    });

    it('falls back to a not-found envelope when the page loader throws and there is no errorPage', async () => {
        matchRoute.mockReturnValue({
            handler: {
                type: 'page',
                mainPage: {
                    manifestPath: '/p',
                    loader: { src: 'l', import: async () => ({ loader: {} }) },
                },
                layouts: [],
                errorPage: undefined,
            },
            params: {},
        });
        runSequentialLoader.mockRejectedValue(new Error('boom'));

        const body = (await serveRouteData(req())) as unknown as {
            type: string;
        };

        expect(body.type).toBe('not-found');
    });
});
