// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoot, createEffect } from 'solid-js';

// Client router runtime: navigation, races, prefetch cache, meta application.
// The envelope transport is mocked (fetch + seroval->JSON) with manually
// resolved promises so response-ordering races are deterministic. This file is
// coverage-excluded (see vitest.config.ts); the kitchen-sink e2e suite remains
// the integration cover.

const matchClientRoute = vi.fn((): unknown => ({ handler: { marker: 'h' } }));
vi.mock('../utils/client-manifest', () => ({
    matchClientRoute: (...a: unknown[]) => matchClientRoute(...a),
}));
const preloadHandler = vi.fn(async (): Promise<void> => undefined);
vi.mock('../utils/client-modules', () => ({
    preloadHandler: (...a: unknown[]) => preloadHandler(...a),
}));
// Envelopes are plain JSON in these tests; bypass real seroval decoding.
vi.mock('seroval', () => ({ deserialize: (t: string) => JSON.parse(t) }));

import {
    navigate,
    initRouter,
    prefetchRoute,
    refreshRoute,
    routeStructure,
    navigationPending,
    usePathname,
    __routerInternals,
    type RouteState,
} from '../utils/router-context';

type PendingFetch = { target: string; resolve: (envelope: unknown) => void };
let fetches: PendingFetch[] = [];

const tick = () => new Promise((r) => setTimeout(r, 0));

const pageEnvelope = (path: string) => ({
    type: 'page',
    manifestPath: path,
    params: {},
    searchParams: {},
    loaderData: {},
    deferredKeys: [],
    meta: {},
});

const initialState: RouteState = {
    pathname: '/',
    search: '',
    params: {},
    searchParams: {},
    manifestPath: '/',
    loaderData: {},
    deferredKeys: [],
    kind: 'page',
    ppr: false,
    firstLoad: true,
};

beforeEach(() => {
    fetches = [];
    matchClientRoute.mockReset().mockReturnValue({ handler: { marker: 'h' } });
    preloadHandler.mockReset().mockResolvedValue(undefined);
    vi.stubGlobal(
        'fetch',
        vi.fn(
            (input: string) =>
                new Promise<Response>((res) => {
                    const target = new URL(
                        input,
                        location.href,
                    ).searchParams.get('url')!;
                    fetches.push({
                        target,
                        resolve: (envelope) =>
                            res({
                                ok: true,
                                status: 200,
                                text: async () => JSON.stringify(envelope),
                            } as Response),
                    });
                }),
        ),
    );
    history.replaceState(null, '', '/');
    initRouter(initialState);
});

const resolveFetch = (target: string, envelope: unknown) => {
    const f = fetches.find((f) => f.target === target);
    if (!f) throw new Error(`no in-flight fetch for ${target}`);
    f.resolve(envelope);
};

describe('navigation races', () => {
    it('a stale navigation response never overwrites a newer one', async () => {
        const first = navigate('/a');
        await tick();
        const second = navigate('/b');
        await tick();

        // The newer navigation (B) lands first.
        resolveFetch('/b', pageEnvelope('/b'));
        await second;
        expect(routeStructure().pathname).toBe('/b');
        expect(location.pathname).toBe('/b');

        // The older navigation (A) resolves late: it must be discarded, not
        // committed over B.
        resolveFetch('/a', pageEnvelope('/a'));
        await first;
        expect(routeStructure().pathname).toBe('/b');
        expect(location.pathname).toBe('/b');
    });

    it('pending stays true until the latest navigation settles', async () => {
        const first = navigate('/a');
        await tick();
        const second = navigate('/b');
        await tick();

        // The superseded navigation finishing must not clear pending while
        // the newer one is still in flight.
        resolveFetch('/a', pageEnvelope('/a'));
        await first;
        expect(navigationPending()).toBe(true);

        resolveFetch('/b', pageEnvelope('/b'));
        await second;
        expect(navigationPending()).toBe(false);
    });

    it('a stale navigate response never overwrites a popstate commit', async () => {
        // A navigation is in flight when the user hits back/forward.
        const nav = navigate('/slow');
        await tick();
        window.dispatchEvent(new PopStateEvent('popstate'));
        await tick();

        // The popstate (for the current location '/') lands first.
        resolveFetch('/', pageEnvelope('/'));
        await tick();
        expect(routeStructure().manifestPath).toBe('/');

        // The older navigate resolves late: discarded.
        resolveFetch('/slow', pageEnvelope('/slow'));
        await nav;
        expect(routeStructure().manifestPath).toBe('/');
        expect(location.pathname).toBe('/');
    });
});

describe('module preload failures', () => {
    it('never commits a route whose modules failed to load', async () => {
        preloadHandler.mockRejectedValue(new Error('chunk load failed'));
        const nav = navigate('/broken');
        await tick();
        resolveFetch('/broken', pageEnvelope('/broken'));
        await nav;
        // The failed preload must reach navigate's hard-nav fallback instead
        // of committing a blank tree; reactive state stays on the old route.
        expect(routeStructure().manifestPath).not.toBe('/broken');
    });
});

describe('cache bounds', () => {
    it('bounds the prefetch cache instead of growing per distinct URL', () => {
        const before = __routerInternals.prefetchCacheSize();
        for (let i = 0; i < 70; i++) prefetchRoute(`/pf-${i}`);
        expect(__routerInternals.prefetchCacheSize()).toBeLessThanOrEqual(64);
        expect(before).toBeLessThanOrEqual(64);
    });

    it('drops an expired prefetch entry when a navigation consumes it', async () => {
        const realNow = Date.now();
        let offset = 0;
        const nowSpy = vi
            .spyOn(Date, 'now')
            .mockImplementation(() => realNow + offset);
        try {
            prefetchRoute('/pf-expired');
            const sizeAfterInsert = __routerInternals.prefetchCacheSize();
            offset = 31_000; // past PREFETCH_TTL (30s)
            const nav = navigate('/pf-expired');
            await tick();
            // The expired entry is bypassed: a fresh fetch is issued...
            const fresh = fetches.filter((f) => f.target === '/pf-expired');
            expect(fresh.length).toBe(2);
            fresh[1].resolve(pageEnvelope('/pf-expired'));
            await nav;
            // ...and the dead entry no longer occupies the map.
            expect(__routerInternals.prefetchCacheSize()).toBeLessThan(
                sizeAfterInsert,
            );
        } finally {
            nowSpy.mockRestore();
        }
    });

    it('bounds the scroll-position map across many distinct navigations', async () => {
        for (let i = 0; i < 120; i++) {
            const nav = navigate(`/sp-${i}`);
            await tick();
            resolveFetch(`/sp-${i}`, pageEnvelope(`/sp-${i}`));
            await nav;
        }
        expect(__routerInternals.scrollPositionsSize()).toBeLessThanOrEqual(
            100,
        );
    });
});

describe('meta application', () => {
    it('removes framework-managed meta tags absent from the new route', async () => {
        const withMeta = {
            ...pageEnvelope('/a'),
            meta: {
                desc: {
                    type: 'meta',
                    attributes: { name: 'description', content: 'A page' },
                },
            },
        };
        const nav1 = navigate('/a');
        await tick();
        resolveFetch('/a', withMeta);
        await nav1;
        expect(
            document.head
                .querySelector('meta[name="description"]')
                ?.getAttribute('content'),
        ).toBe('A page');

        // Route B has no description: A's tag must not leak across.
        const nav2 = navigate('/b');
        await tick();
        resolveFetch('/b', pageEnvelope('/b'));
        await nav2;
        expect(document.head.querySelector('meta[name="description"]')).toBe(
            null,
        );
    });

    it('applies and removes link/script meta types across navigations (canonical/JSON-LD)', async () => {
        const withLink = {
            ...pageEnvelope('/a'),
            meta: {
                canonical: {
                    type: 'link',
                    attributes: { rel: 'canonical', href: 'https://x.test/a' },
                },
            },
        };
        const nav1 = navigate('/a');
        await tick();
        resolveFetch('/a', withLink);
        await nav1;
        expect(
            document.head
                .querySelector('link[rel="canonical"]')
                ?.getAttribute('href'),
        ).toBe('https://x.test/a');

        // Route B declares no canonical: A's must not leak across.
        const nav2 = navigate('/b');
        await tick();
        resolveFetch('/b', pageEnvelope('/b'));
        await nav2;
        expect(document.head.querySelector('link[rel="canonical"]')).toBe(null);
    });
});

describe('usePathname over-subscription', () => {
    it('does not re-run when only loaderData changes (a same-route revalidation)', async () => {
        let runs = 0;
        let dispose: () => void;
        await new Promise<void>((resolve) => {
            createRoot((d) => {
                dispose = d;
                createEffect(() => {
                    usePathname()();
                    runs += 1;
                    if (runs === 1) resolve();
                });
            });
        });
        const before = runs;

        const refresh = refreshRoute();
        await tick();
        resolveFetch('/', pageEnvelope('/'));
        await refresh;

        // A loaderData-only update must not re-trigger something that only
        // reads the pathname.
        expect(runs).toBe(before);
        dispose!();
    });
});
