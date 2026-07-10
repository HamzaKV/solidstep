import { hydrate, createComponent } from 'solid-js/web';
import { Suspense, ErrorBoundary, createUniqueId, untrack } from 'solid-js';
import { deserialize } from 'seroval';
import 'vinxi/client';
import { createDeferredResource } from './utils/deferred.js';
import {
    matchClientRoute,
    getNotFoundHandler,
    type ClientPageHandler,
    type ClientImport,
} from './utils/client-manifest.js';
import { getModule, preloadHandler } from './utils/client-modules.js';
import type { SearchParams } from './utils/path-router.js';
import {
    isLoaderErrorSentinel,
    LOADER_ERROR_KEY,
} from './utils/loader-error-sentinel.js';
import {
    routeStructure,
    routeLoaderData,
    initRouter,
    type RouteState,
    type RouteStructure,
    type RouteKind,
} from './utils/router-context.js';

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
        .then((r) => {
            // A non-2xx body is not a seroval envelope — fail the resource so
            // the ErrorBoundary handles it instead of a deserialize crash.
            if (!r.ok) throw new Error(`Hole fetch failed (${r.status})`);
            return r.text();
        })
        // The hole envelope is seroval-serialized (see `serveHoleData`), so
        // deserialize rather than `r.json()` — this preserves Date/Map/Set/etc.
        .then((t) => {
            const envelope = deserialize(t) as { data?: any; error?: string };
            // A failed hole loader arrives as an `{ error }` envelope; rethrow
            // it so <Suspense>/<ErrorBoundary> treat it as the loader failure.
            if (envelope.error !== undefined) throw new Error(envelope.error);
            return envelope.data;
        });

/** Synchronously read a preloaded component's default export. */
const comp = (imp: { src: string }) => getModule(imp.src)?.default;

/**
 * Wrap `inner` in an `ErrorBoundary` using `fallback`, burning one
 * `createUniqueId()` id first. `ErrorBoundary` reads its own hydration-restore
 * data via a *non-incrementing* id peek (`getContextId()`); without something
 * between it and the nested Suspense/resource to consume an id first, the
 * resource's own (incrementing) id lands on that same unconsumed slot, so the
 * boundary picks up the raw resource hydration entry as its "error" instead
 * of its own (usually absent) one. `server/render.ts`'s `idSafeErrorBoundary`
 * mirrors this exactly so both sides assign the same ids.
 */
const idSafeErrorBoundary = (fallback: (err: any) => any, inner: () => any) =>
    createComponent(ErrorBoundary, {
        fallback,
        get children() {
            createUniqueId();
            return inner();
        },
    });

/**
 * Fallback used to wrap a Suspense-ed node when its route has no `error.tsx`.
 * Without SOME ErrorBoundary here, a rejected resource (deferred loader
 * failure, hole-fetch failure) throws uncaught through `hydrate()` — Solid
 * has nothing local to catch it, the exception propagates to the very top of
 * the tree, and the entire page's hydration aborts (observed: a blank
 * `<body>`/`<main>`, not just the one failing slot). Containing it here keeps
 * the failure local to its own boundary, matching what an author-provided
 * `error.tsx` would do, just with no visible fallback UI.
 */
const defaultBoundaryFallback = (err: unknown) => {
    console.error(
        '[solidstep] boundary error (no error.tsx for this route/group):',
        err,
    );
    return undefined;
};

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
        // Mirrors server/render.ts's `needsWrap`: ANY boundary (loading or
        // error), not just a true `type: 'defer'` loader, gets the
        // resource-style calling convention (`loaderData()` as a function) —
        // components under a boundary are authored against that shape on
        // first load regardless of whether their own loader is deferred.
        const hasBoundary = isDeferred || !!GroupLoading || !!GroupError;
        slots[slotName] = () => {
            const inner = () => {
                if (!hasBoundary) {
                    return GroupComp({
                        routeParams: st.params,
                        searchParams: st.searchParams,
                        get loaderData() {
                            return routeLoaderData()[group.manifestPath] ?? {};
                        },
                    });
                }
                if (isDeferred) {
                    const resource = deferredResourceFor(
                        group.manifestPath,
                        st,
                    );
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
                }
                // Has a boundary but isn't truly deferred: the data already
                // arrived resolved in the envelope/hydration payload. Present
                // it through the same callable-accessor contract a resource
                // would (so the component code is identical either way), and
                // throw an isolated-loader-failure sentinel so the
                // ErrorBoundary below catches it — matching the throw-based
                // contract `render.ts` gives this same group on first load.
                return GroupComp({
                    routeParams: st.params,
                    searchParams: st.searchParams,
                    loaderData: () => {
                        const data = routeLoaderData()[group.manifestPath];
                        if (isLoaderErrorSentinel(data)) {
                            throw new Error(data[LOADER_ERROR_KEY]);
                        }
                        return data ?? {};
                    },
                });
            };
            // Only a boundary-wrapped (Suspense-ed) node can throw here — a
            // plain group's data is already resolved, so wrapping it would
            // burn an id the server never burns for that same node, breaking
            // hydration parity.
            if (!hasBoundary) return inner();
            return idSafeErrorBoundary(
                GroupError
                    ? (err: any) =>
                          createComponent(GroupError, {
                              error: err,
                              routeParams: st.params,
                              searchParams: st.searchParams,
                          })
                    : defaultBoundaryFallback,
                inner,
            );
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
        const PageError = handler.errorPage
            ? comp(handler.errorPage.page)
            : null;
        const inner = () =>
            createComponent(Suspense, {
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
        // Already inside the deferred (Suspense-wrapped) branch here, so
        // always wrap — see defaultBoundaryFallback.
        return idSafeErrorBoundary(
            PageError
                ? (err: any) =>
                      createComponent(PageError, {
                          error: err,
                          routeParams: st.params,
                          searchParams: st.searchParams,
                      })
                : defaultBoundaryFallback,
            inner,
        );
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
/** Render a single layout node, deferring to its own `<Suspense>`/`<ErrorBoundary>`
 * (falling back to the route's `loading.tsx`/`error.tsx` -- layouts have no
 * per-node equivalent) when its loader is deferred. Mirrors the server's
 * per-layout block in `server/render.ts`'s compose loop. */
const renderLayoutNode = (
    handler: ClientPageHandler,
    st: RouteStructure,
    layout: { manifestPath: string; layout: ClientImport },
    childThunk: () => any,
    slots: Record<string, () => any>,
): any => {
    const LayoutComp = comp(layout.layout);
    if (!LayoutComp) return childThunk();
    const buildProps = (loaderData: unknown) => ({
        children: childThunk,
        routeParams: st.params,
        searchParams: st.searchParams,
        slots,
        loaderData,
    });
    if (!st.deferredKeys.includes(layout.manifestPath)) {
        return LayoutComp({
            ...buildProps(undefined),
            get loaderData() {
                return routeLoaderData()[layout.manifestPath] ?? {};
            },
        });
    }
    const resource = deferredResourceFor(layout.manifestPath, st);
    const Loading = handler.loadingPage ? comp(handler.loadingPage.page) : null;
    const LayoutError = handler.errorPage ? comp(handler.errorPage.page) : null;
    const inner = () =>
        createComponent(Suspense, {
            fallback: Loading
                ? createComponent(Loading, {
                      routeParams: st.params,
                      searchParams: st.searchParams,
                  })
                : undefined,
            get children() {
                return LayoutComp(buildProps(resource));
            },
        });
    // Already inside the deferred (Suspense-wrapped) branch here, so always
    // wrap — an unwrapped Suspense would let a rejection throw uncaught
    // through `hydrate()` and crash the whole tree (see defaultBoundaryFallback).
    return idSafeErrorBoundary(
        LayoutError
            ? (err: any) =>
                  createComponent(LayoutError, {
                      error: err,
                      routeParams: st.params,
                      searchParams: st.searchParams,
                  })
            : defaultBoundaryFallback,
        inner,
    );
};

const composeFrom = (
    handler: ClientPageHandler,
    st: RouteStructure,
    startIndex: number,
): (() => any) => {
    let acc: () => any = () => renderLeaf(handler, st);
    const layouts = handler.layouts;
    for (let i = layouts.length - 1; i >= startIndex; i--) {
        const layout = layouts[i];
        const childThunk = acc;
        const slots = i === layouts.length - 1 ? buildSlots(handler, st) : {};
        acc = () => renderLayoutNode(handler, st, layout, childThunk, slots);
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
    const rootBaseProps = {
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
    };

    // The root layout is rendered once (not inside `belowRoot`'s reactive
    // re-run), so a deferred root loader needs its own Suspense/ErrorBoundary
    // wrap here -- it can't reuse `renderLayoutNode` (built for the reactive,
    // re-run-per-navigation layouts in `composeFrom`).
    if (!st0.deferredKeys.includes(rootLayout.manifestPath)) {
        return RootComp({
            ...rootBaseProps,
            get loaderData() {
                return routeLoaderData()[rootLayout.manifestPath] ?? {};
            },
        });
    }
    const resource = deferredResourceFor(rootLayout.manifestPath, st0);
    const Loading = handler0.loadingPage
        ? comp(handler0.loadingPage.page)
        : null;
    const RootError = handler0.errorPage ? comp(handler0.errorPage.page) : null;
    const inner = () =>
        createComponent(Suspense, {
            fallback: Loading
                ? createComponent(Loading, {
                      get routeParams() {
                          return routeStructure().params;
                      },
                      get searchParams() {
                          return routeStructure().searchParams;
                      },
                  })
                : undefined,
            get children() {
                return RootComp({ ...rootBaseProps, loaderData: resource });
            },
        });
    if (RootError) {
        return idSafeErrorBoundary(
            (err: any) =>
                createComponent(RootError, {
                    error: err,
                    get routeParams() {
                        return routeStructure().params;
                    },
                    get searchParams() {
                        return routeStructure().searchParams;
                    },
                }),
            inner,
        );
    }
    return inner();
};

/**
 * Client entry. Called by the SSR-emitted hydration script with the server's
 * route state. Seeds the reactive router, preloads the current route's
 * component modules, and hydrates once. Subsequent navigations are driven by the
 * reactive `route()` signal (see `utils/router-context`).
 */
export const main = async (
    modulePath: string,
    routeParams: Record<string, string | string[]> = {},
    searchParams: SearchParams = {},
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
    if (handler) {
        try {
            await preloadHandler(handler);
        } catch (e) {
            // A chunk failed on first load: hydrating would render a blank
            // tree from missing modules. Leave the server HTML as-is (links
            // hard-navigate without the router).
            console.error(
                '[solidstep] failed to load route modules; skipping hydration:',
                e,
            );
            return;
        }
    }

    initRouter(initial);
    hydrate(() => renderTree(), document);
};

export default main;
