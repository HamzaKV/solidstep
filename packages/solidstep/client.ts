import { hydrate, createComponent } from 'solid-js/web';
import { Suspense, ErrorBoundary, untrack } from 'solid-js';
import 'vinxi/client';
import { createDeferredResource } from './utils/deferred';
import {
    matchClientRoute,
    getNotFoundHandler,
    type ClientPageHandler,
} from './utils/client-manifest';
import { getModule, preloadHandler } from './utils/client-modules';
import {
    routeStructure,
    routeLoaderData,
    initRouter,
    type RouteState,
    type RouteStructure,
    type RouteKind,
} from './utils/router-context';

/**
 * Fetch a PPR hole's loader data from the server (first-load only). `manifest`
 * identifies the page/group node; the current URL gives the loader its
 * params/search.
 */
const fetchHole = (manifest: string): Promise<any> =>
    fetch(
        `/__solidstep_loader?manifest=${encodeURIComponent(
            manifest,
        )}&url=${encodeURIComponent(location.pathname + location.search)}`,
    )
        .then((r) => r.json())
        .then((j) => j.data);

/** Synchronously read a preloaded component's default export. */
const comp = (imp: { src: string }) => getModule(imp.src)?.default;

/**
 * Resolve the loader-data accessor a deferred node should receive.
 * - first load, streamed (`!ppr`): `undefined` → the Solid resource reads the
 *   streamed value from `_$HY` at the matching tree position.
 * - first load PPR, and soft navigation: fetch the hole from the server via
 *   `/__solidstep_loader`, so the `<Suspense fallback>` (loading.tsx) shows
 *   until the data streams in.
 */
const deferredResourceFor = (mp: string, st: RouteStructure) =>
    createDeferredResource(st.firstLoad && !st.ppr ? undefined : fetchHole(mp));

/**
 * Build the parallel-route slot thunks for the last layout. Mirrors the
 * server's group rendering (`server.ts`) so hydration matches: plain groups are
 * called directly; boundary/deferred groups are wrapped in
 * `<Suspense>`/`<ErrorBoundary>`.
 */
const buildSlots = (handler: ClientPageHandler, st: RouteStructure) => {
    const slots: Record<string, () => any> = {};
    for (const [groupName, group] of Object.entries(handler.groups)) {
        const slotName = groupName.replace('@', '');
        const GroupComp = comp(group.page);
        if (!GroupComp) continue;
        const GroupLoading = group.loadingPage ? comp(group.loadingPage) : null;
        const GroupError = group.errorPage ? comp(group.errorPage) : null;
        const isDeferred = st.deferredKeys.includes(group.manifestPath);
        slots[slotName] = () => {
            const inner = () => {
                if (!isDeferred) {
                    return GroupComp({
                        routeParams: st.params,
                        searchParams: st.searchParams,
                        get loaderData() {
                            return routeLoaderData()[group.manifestPath] ?? {};
                        },
                    });
                }
                const resource = deferredResourceFor(group.manifestPath, st);
                return createComponent(Suspense, {
                    fallback: GroupLoading
                        ? createComponent(GroupLoading, {
                              routeParams: st.params,
                              searchParams: st.searchParams,
                          })
                        : undefined,
                    get children() {
                        return GroupComp({
                            routeParams: st.params,
                            searchParams: st.searchParams,
                            loaderData: resource,
                        });
                    },
                });
            };
            if (GroupError) {
                return createComponent(ErrorBoundary, {
                    fallback: (err: any) =>
                        createComponent(GroupError, {
                            error: err,
                            routeParams: st.params,
                            searchParams: st.searchParams,
                        }),
                    get children() {
                        return inner();
                    },
                });
            }
            return inner();
        };
    }
    return slots;
};

/** Render the leaf (page / error / not-found) for the current route. */
const renderLeaf = (handler: ClientPageHandler, st: RouteStructure) => {
    if (st.kind === 'not-found') {
        const nf = getNotFoundHandler();
        const C = nf ? comp(nf.page) : undefined;
        return C
            ? C({
                  routeParams: st.params,
                  searchParams: st.searchParams,
                  loaderData: {},
              })
            : undefined;
    }
    if (st.kind === 'error') {
        const C = handler.errorPage ? comp(handler.errorPage.page) : undefined;
        if (!C) return undefined;
        const errorMp = handler.errorPage?.manifestPath;
        return C({
            error: st.errorMessage ? { message: st.errorMessage } : undefined,
            routeParams: st.params,
            searchParams: st.searchParams,
            get loaderData() {
                return errorMp ? (routeLoaderData()[errorMp] ?? {}) : {};
            },
        });
    }
    const Page = comp(handler.mainPage.page);
    if (!Page) return undefined;
    const mp = handler.mainPage.manifestPath;
    if (st.deferredKeys.includes(mp)) {
        const resource = deferredResourceFor(mp, st);
        // The route's loading.tsx is the Suspense fallback for a deferred page
        // (shown while the hole streams in on a navigation). On first load the
        // resource resolves from `_$HY` without suspending, so it never flashes.
        const Loading = handler.loadingPage
            ? comp(handler.loadingPage.page)
            : null;
        return createComponent(Suspense, {
            fallback: Loading
                ? createComponent(Loading, {
                      routeParams: st.params,
                      searchParams: st.searchParams,
                  })
                : undefined,
            get children() {
                return Page({
                    routeParams: st.params,
                    searchParams: st.searchParams,
                    loaderData: resource,
                });
            },
        });
    }
    return Page({
        routeParams: st.params,
        searchParams: st.searchParams,
        get loaderData() {
            return routeLoaderData()[mp] ?? {};
        },
    });
};

/**
 * Resolve the handler whose layout chain wraps the current leaf: the matched
 * route for `page`/`error`, or the root route (for its layout) when rendering
 * the not-found page.
 */
const handlerFor = (st: RouteStructure): ClientPageHandler | null => {
    if (st.kind === 'not-found') {
        return matchClientRoute('/')?.handler ?? null;
    }
    return matchClientRoute(st.pathname)?.handler ?? null;
};

/**
 * Render the whole route tree from the current route. Reads the *structural*
 * route signal at the top, so a navigation (structure change) re-runs it and
 * re-renders the page tree (whole-page remount). Loader data is read through
 * reactive getters, so a same-route revalidation updates the mounted components
 * in place without remounting (preserving their local state).
 *
 * The FIRST run reproduces the server's direct-call structure exactly, so
 * hydration matches: user layout/page/group components are called directly; only
 * Suspense/ErrorBoundary use `createComponent`, as on the server.
 */
/**
 * Compose `layouts[startIndex..]` around the leaf for `handler`, returning a
 * thunk. Slots attach to the last layout. Components are called directly (matching
 * the server) so hydration is consistent; loader data flows via reactive getters.
 */
const composeFrom = (
    handler: ClientPageHandler,
    st: RouteStructure,
    startIndex: number,
): (() => any) => {
    let acc: () => any = () => renderLeaf(handler, st);
    const layouts = handler.layouts;
    for (let i = layouts.length - 1; i >= startIndex; i--) {
        const layout = layouts[i];
        const LayoutComp = comp(layout.layout);
        const childThunk = acc;
        const slots = i === layouts.length - 1 ? buildSlots(handler, st) : {};
        acc = () => {
            if (!LayoutComp) return childThunk();
            return LayoutComp({
                children: childThunk,
                routeParams: st.params,
                searchParams: st.searchParams,
                slots,
                get loaderData() {
                    return routeLoaderData()[layout.manifestPath] ?? {};
                },
            });
        };
    }
    return acc;
};

/**
 * Render the route tree. The root layout (index 0) is invariant across
 * navigations, so it is rendered ONCE — this is what hydrates against the
 * server-rendered `<body>`/document. Its `children` is a reactive thunk
 * (`belowRoot`) that re-derives everything below the root from the current
 * route, so a navigation re-renders the sub-tree (the root layout — nav, etc. —
 * stays mounted) while a same-route revalidation only updates loader data via
 * the reactive getters. The first render reproduces the server's direct-call
 * structure exactly, so hydration matches.
 */
const renderTree = () => {
    const st0 = untrack(routeStructure);
    const handler0 = handlerFor(st0);
    if (!handler0) return undefined;

    // Everything below the root layout, re-derived reactively from the route.
    const belowRoot = () => {
        const st = routeStructure();
        const handler = handlerFor(st);
        if (!handler) return undefined;
        const start = handler.layouts.length > 0 ? 1 : 0;
        return composeFrom(handler, st, start)();
    };

    const rootLayout = handler0.layouts[0];
    const RootComp = rootLayout ? comp(rootLayout.layout) : undefined;
    if (!rootLayout || !RootComp) return belowRoot();

    // Slots attach to the root layout only when it is the route's *last* layout.
    const rootSlots = () => {
        const st = routeStructure();
        const handler = handlerFor(st);
        return handler && handler.layouts.length === 1
            ? buildSlots(handler, st)
            : {};
    };

    return RootComp({
        children: belowRoot,
        get routeParams() {
            return routeStructure().params;
        },
        get searchParams() {
            return routeStructure().searchParams;
        },
        get slots() {
            return rootSlots();
        },
        get loaderData() {
            return routeLoaderData()[rootLayout.manifestPath] ?? {};
        },
    });
};

/**
 * Client entry. Called by the SSR-emitted hydration script with the server's
 * route state. Seeds the reactive router, preloads the current route's
 * component modules, and hydrates once. Subsequent navigations are driven by the
 * reactive `route()` signal (see `utils/router-context`).
 */
export const main = async (
    modulePath: string,
    routeParams: Record<string, string> = {},
    searchParams: Record<string, string> = {},
    loaderDataManifest: Record<string, any> = {},
    deferred: string[] = [],
    ppr = false,
) => {
    const kind: RouteKind = modulePath.startsWith('/not-found')
        ? 'not-found'
        : modulePath.startsWith('/error')
          ? 'error'
          : 'page';

    const initial: RouteState = {
        pathname: location.pathname,
        search: location.search,
        params: routeParams,
        searchParams,
        manifestPath: kind === 'page' ? modulePath : '',
        loaderData: loaderDataManifest,
        deferredKeys: deferred,
        kind,
        errorPageManifest: kind === 'error' ? modulePath : undefined,
        ppr,
        firstLoad: true,
    };

    // Preload every module the first render needs so `renderTree` is synchronous
    // and hydration is clean.
    const handler =
        kind === 'not-found'
            ? matchClientRoute('/')?.handler
            : matchClientRoute(location.pathname)?.handler;
    if (handler) await preloadHandler(handler);

    initRouter(initial);
    hydrate(() => renderTree(), document);
};

export default main;
