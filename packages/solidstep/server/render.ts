import { getManifest } from 'vinxi/manifest';
import { renderToString, createComponent } from 'solid-js/web';
import { Suspense, ErrorBoundary, createUniqueId } from 'solid-js';
import { createDeferredResource } from '../utils/deferred.js';
import type { Meta } from '../utils/meta.js';
import { getCache, setCacheWithOptions } from '../utils/cache.js';
import { getCachedLoaderData } from '../utils/loader-cache.js';
import { runSequentialLoader } from '../utils/loader-error.js';
import { shouldCachePage, pageCacheKey } from '../utils/page-cache.js';
import { isPreviewActive } from '../utils/preview.js';
import type {
    Import,
    RoutePageHandler,
    SearchParams,
} from '../utils/path-router.js';
import type { Options } from '../utils/options.js';
import { getCachedModule, getCachedAssets } from './route-manifest.js';
import type {
    ComponentFn,
    LoaderModule,
    MetaModule,
    PageModule,
    PageVariantNode,
    RenderAsset,
    RenderPlainResult,
    RenderResult,
} from './types.js';

/**
 * Wrap `inner` in an `ErrorBoundary` using `fallback`, burning one
 * `createUniqueId()` id first. `ErrorBoundary` reads its own hydration-restore
 * data via a *non-incrementing* id peek; with nothing between it and the
 * nested Suspense/resource to consume an id first, the resource's own
 * (incrementing) id would land on that same unconsumed slot, so the client's
 * boundary would pick up the raw resource hydration entry as its "error"
 * instead of its own (usually absent) one. `client.ts`'s `idSafeErrorBoundary`
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

/** Arguments for {@link render}. */
type RenderArgs = {
    toRender: 'main' | 'loading' | 'error' | 'not-found';
    entry: RoutePageHandler;
    routeParams: Record<string, string | string[]>;
    searchParams: SearchParams;
    req: Request;
    pageOptions?: Options;
    cspNonce?: string;
    locals?: Record<string, unknown>;
    error?: Error;
    /** Pre-parsed request URL, so callers that already built one (the
     * dispatcher) don't force a second `new URL()` per request. */
    url?: URL;
};

export const template = `
    <!DOCTYPE html>
    <html lang="en">
    <head><!--app-head--></head>
    <!--app-body-->
    </html>
`;

// Non-`main` renders (loading / error / not-found) never defer or PPR, so they
// always resolve to a plain result — the overload lets callers skip narrowing.
export function render(
    args: RenderArgs & { toRender: 'loading' | 'error' | 'not-found' },
): Promise<RenderPlainResult>;
export function render(args: RenderArgs): Promise<RenderResult>;
export async function render(args: RenderArgs): Promise<RenderResult> {
    const {
        toRender,
        entry,
        routeParams,
        searchParams,
        req,
        pageOptions,
        cspNonce,
        locals,
        error,
        url: preParsedUrl,
    } = args;
    const url = preParsedUrl ?? new URL(req.url);
    // Request-scoped context threaded into every loader on this render: the
    // middleware-populated `locals` (with the CSP nonce folded in for parity with
    // the component props) and the request's abort signal for cancellation.
    const loaderInvocation = {
        locals: { ...locals, cspNonce },
        signal: req.signal,
    };
    // SSG (`static`), ISR, and PPR pages have their own artifact/ISR cache (or a
    // shell artifact); plain dynamic pages are cached only when they opt in with
    // a positive `cache.ttl`. The key includes the query string so `?q=a` and
    // `?q=b` don't collide. See `utils/page-cache`.
    const isPPR = pageOptions?.render === 'ppr';
    const shouldCache = shouldCachePage(pageOptions);
    // Preview mode reads and writes an entirely separate cache namespace, so
    // a preview render can never see (or pollute) what a non-preview visitor
    // gets served — see the matching comment in `utils/loader-cache.ts`. Only
    // computed when the page actually caches — skip the preview check and key
    // construction for the common (uncached, dynamic) page.
    let cacheKey = '';
    let cachedEntry: {
        rendered: string;
        documentMeta: Meta;
        documentAssets: RenderAsset[];
        loaderData: Record<string, unknown>;
    } | null = null;
    if (shouldCache) {
        cacheKey = isPreviewActive()
            ? `preview:${pageCacheKey(url)}`
            : pageCacheKey(url);
        cachedEntry = await getCache<{
            rendered: string;
            documentMeta: Meta;
            documentAssets: RenderAsset[];
            loaderData: Record<string, unknown>;
        }>(cacheKey);
    }

    if (cachedEntry && toRender === 'main') {
        return {
            rendered: cachedEntry.rendered,
            documentMeta: cachedEntry.documentMeta,
            documentAssets: cachedEntry.documentAssets,
            loaderData: cachedEntry.loaderData,
            cacheStatus: 'hit',
        };
    }

    type CacheOptions = {
        ttl?: number;
        swr?: number;
        tags?: string[];
    };
    let meta: Meta = {};
    const loaderData: Record<string, unknown> = {};
    const clientManifest = getManifest('client');
    const assets: RenderAsset[] = [];

    // Select the page variant being rendered up front so its loader can be
    // pre-resolved alongside the layout loaders.
    const pageToRender: PageVariantNode | undefined =
        toRender === 'loading'
            ? entry.loadingPage
            : toRender === 'error'
              ? entry.errorPage
              : toRender === 'not-found'
                ? entry.notFoundPage
                : entry.mainPage;

    // Run every layout loader and the page loader concurrently instead of
    // sequentially down the layout chain. Results are keyed by manifestPath and
    // applied in tree order below, so loaderData ordering and per-node data are
    // unchanged — only the awaits now overlap.
    const loaderTargets: { manifestPath: string; loader: Import }[] = [];
    for (const layout of entry.layouts) {
        if (layout.loader) {
            loaderTargets.push({
                manifestPath: layout.manifestPath,
                loader: layout.loader,
            });
        }
    }
    if (pageToRender?.loader) {
        loaderTargets.push({
            manifestPath: pageToRender.manifestPath,
            loader: pageToRender.loader,
        });
    }
    // A `$loader` import is created for every layout/page node, even when the
    // file exports no loader — in that case the picked module is empty and has
    // no `loader` export, so we skip it. Only nodes whose loader actually ran
    // get an entry here, which is how the closures below decide whether to
    // populate loaderData (matching the previous in-closure behavior).
    const resolvedLoaderData = new Map<string, unknown>();
    // Deferred loaders (`type: 'defer'`) are started but NOT awaited here; their
    // promise is handed to a Solid resource so the component can stream it in
    // under `<Suspense>`. Sequential loaders are awaited as before.
    const deferredLoaderData = new Map<string, Promise<unknown>>();
    await Promise.all(
        loaderTargets.map(async ({ manifestPath, loader }) => {
            const { loader: loaderFn } =
                await getCachedModule<LoaderModule>(loader);
            if (!loaderFn) return;
            // Page and layout loaders both support `defer`.
            const isDeferred = loaderFn.options?.type === 'defer';
            if (isDeferred) {
                // PPR: don't run the loader at build/shell time — leave the hole
                // pending so `renderToString` emits its fallback. The client
                // fetches the data and fills it in.
                if (isPPR) {
                    deferredLoaderData.set(
                        manifestPath,
                        new Promise<unknown>(() => undefined),
                    );
                    return;
                }
                const pending = getCachedLoaderData(
                    loaderFn,
                    manifestPath,
                    req,
                    loaderInvocation,
                );
                // Swallow rejections here; the resource created from this promise
                // re-observes it and routes the error to a Suspense/ErrorBoundary.
                pending.catch(() => undefined);
                deferredLoaderData.set(manifestPath, pending);
                return;
            }
            // Isolate sequential loader failures: a layout/group loader that
            // throws yields a serializable error sentinel (siblings still
            // render); only the page loader re-throws to the route error page.
            const data = await runSequentialLoader(
                loaderFn,
                manifestPath,
                req,
                manifestPath === pageToRender?.manifestPath,
                loaderInvocation,
            );
            resolvedLoaderData.set(manifestPath, data);
        }),
    );
    const hasDeferred = deferredLoaderData.size > 0;
    // Set by the group loop below when a group has a loading/error boundary or a
    // deferred loader — such routes also take the streaming path.
    let hasStreamingGroup = false;

    const compose = entry.layouts.reduceRight(
        (children, layout, index) => async () => {
            const moduleSrc = `${layout.layout.src}&pick=$css`;
            // Independent lookups for this node — fetched concurrently. Order
            // of *execution* relative to sibling/parent nodes is unchanged
            // (still top-down via reduceRight); only the awaits within this
            // one node now overlap instead of chaining. Only Promise.all the
            // generateMeta fetch in when it actually exists — a filler
            // `Promise.resolve(...)` for the common no-generateMeta layout
            // would just add allocation/microtask overhead to the trivial
            // case for no benefit (nothing to overlap it with).
            let moduleAssets: unknown[];
            let layoutModule: PageModule['default'];
            let generateMetaPage: MetaModule['generateMeta'] | null;
            if (layout.generateMeta) {
                const [assetsResult, layoutModuleResult, metaModuleResult] =
                    await Promise.all([
                        getCachedAssets(clientManifest, moduleSrc),
                        getCachedModule<PageModule>(layout.layout),
                        getCachedModule<MetaModule>(layout.generateMeta),
                    ]);
                moduleAssets = assetsResult;
                layoutModule = layoutModuleResult.default;
                generateMetaPage = metaModuleResult.generateMeta;
            } else {
                const [assetsResult, layoutModuleResult] = await Promise.all([
                    getCachedAssets(clientManifest, moduleSrc),
                    getCachedModule<PageModule>(layout.layout),
                ]);
                moduleAssets = assetsResult;
                layoutModule = layoutModuleResult.default;
                generateMetaPage = null;
            }
            assets.push(...(moduleAssets as RenderAsset[]));
            let data: unknown = {};
            if (generateMetaPage) {
                const metaData = await generateMetaPage({
                    req,
                    cspNonce,
                });
                if (metaData) {
                    meta = {
                        ...meta,
                        ...metaData,
                    };
                }
            }
            if (resolvedLoaderData.has(layout.manifestPath)) {
                data = resolvedLoaderData.get(layout.manifestPath);
                loaderData[layout.manifestPath] = data;
            }
            const slots: Record<string, () => unknown> = {};
            const slotPromises: Promise<unknown>[] = [children()];
            if (index === entry.layouts.length - 1) {
                // last layout, we can render slots
                const groups = entry.groups || {};
                for (const [groupName, group] of Object.entries(groups)) {
                    slotPromises.push(
                        (async () => {
                            const slotName = groupName.replace('@', '');
                            const moduleSrc = `${group.page.src}&pick=$css`;
                            // Only Promise.all the loader fetch in when the
                            // group actually has one — see the matching
                            // comment on the layout closure above.
                            let moduleAssets: unknown[];
                            let groupPage: ComponentFn;
                            let groupLoader: LoaderModule['loader'] | null;
                            if (group.loader) {
                                const [assetsResult, pageResult, loaderResult] =
                                    await Promise.all([
                                        getCachedAssets(
                                            clientManifest,
                                            moduleSrc,
                                        ),
                                        getCachedModule<PageModule>(group.page),
                                        getCachedModule<LoaderModule>(
                                            group.loader,
                                        ),
                                    ]);
                                moduleAssets = assetsResult;
                                groupPage = pageResult.default;
                                groupLoader = loaderResult.loader;
                            } else {
                                const [assetsResult, pageResult] =
                                    await Promise.all([
                                        getCachedAssets(
                                            clientManifest,
                                            moduleSrc,
                                        ),
                                        getCachedModule<PageModule>(group.page),
                                    ]);
                                moduleAssets = assetsResult;
                                groupPage = pageResult.default;
                                groupLoader = null;
                            }
                            assets.push(...(moduleAssets as RenderAsset[]));

                            const groupDeferred =
                                groupLoader?.options?.type === 'defer';
                            const needsWrap =
                                !!group.loadingPage ||
                                !!group.errorPage ||
                                groupDeferred;

                            // Plain group (no boundary): await its loader and
                            // pass the data directly, exactly as before.
                            if (!needsWrap) {
                                let data: unknown = {};
                                if (groupLoader) {
                                    // Isolate: a failing plain-group loader
                                    // yields a sentinel rather than taking down
                                    // the whole render.
                                    data = await runSequentialLoader(
                                        groupLoader,
                                        group.manifestPath,
                                        req,
                                        false,
                                        loaderInvocation,
                                    );
                                    loaderData[group.manifestPath] = data;
                                }
                                slots[slotName] = () =>
                                    groupPage({
                                        routeParams,
                                        searchParams,
                                        loaderData: data,
                                    });
                                return;
                            }

                            // Boundary group: render via <Suspense>/<ErrorBoundary>
                            // so its loading.tsx/error.tsx isolate this slot.
                            hasStreamingGroup = true;
                            let GroupLoading: ComponentFn | null = null;
                            let GroupError: ComponentFn | null = null;
                            // Loading/error boundary fetches are independent
                            // of each other — run concurrently, but still
                            // pushed to `assets` in the same (loading, then
                            // error) order as before.
                            const [loadingFetch, errorFetch] =
                                await Promise.all([
                                    group.loadingPage
                                        ? Promise.all([
                                              getCachedAssets(
                                                  clientManifest,
                                                  `${group.loadingPage.src}&pick=$css`,
                                              ),
                                              getCachedModule<PageModule>(
                                                  group.loadingPage,
                                              ),
                                          ])
                                        : Promise.resolve(null),
                                    group.errorPage
                                        ? Promise.all([
                                              getCachedAssets(
                                                  clientManifest,
                                                  `${group.errorPage.src}&pick=$css`,
                                              ),
                                              getCachedModule<PageModule>(
                                                  group.errorPage,
                                              ),
                                          ])
                                        : Promise.resolve(null),
                                ]);
                            if (loadingFetch) {
                                const [loadingAssets, loadingModule] =
                                    loadingFetch;
                                assets.push(
                                    ...(loadingAssets as RenderAsset[]),
                                );
                                GroupLoading = loadingModule.default;
                            }
                            if (errorFetch) {
                                const [errorAssets, errorModule] = errorFetch;
                                assets.push(...(errorAssets as RenderAsset[]));
                                GroupError = errorModule.default;
                            }
                            // A boundary group with a loader streams its data in
                            // as a resource (so loader errors reach the
                            // ErrorBoundary and hydrate consistently).
                            let pending: Promise<unknown> | null = null;
                            if (groupLoader) {
                                if (isPPR && groupDeferred) {
                                    // PPR hole: leave pending so the shell shows
                                    // the fallback; the client fetches it.
                                    pending = new Promise<unknown>(
                                        () => undefined,
                                    );
                                } else {
                                    pending = getCachedLoaderData(
                                        groupLoader,
                                        group.manifestPath,
                                        req,
                                        loaderInvocation,
                                    );
                                    pending.catch(() => undefined);
                                }
                                deferredLoaderData.set(
                                    group.manifestPath,
                                    pending,
                                );
                            }
                            slots[slotName] = () => {
                                const inner = () => {
                                    if (!pending) {
                                        return groupPage({
                                            routeParams,
                                            searchParams,
                                            loaderData: {},
                                        });
                                    }
                                    const resource =
                                        createDeferredResource(pending);
                                    return createComponent(Suspense, {
                                        fallback: GroupLoading
                                            ? createComponent(GroupLoading, {
                                                  routeParams,
                                                  searchParams,
                                              })
                                            : undefined,
                                        get children() {
                                            return groupPage({
                                                routeParams,
                                                searchParams,
                                                loaderData: resource,
                                            });
                                        },
                                    });
                                };
                                if (GroupError) {
                                    return idSafeErrorBoundary(
                                        (err: unknown) =>
                                            createComponent(GroupError, {
                                                error: err,
                                                routeParams,
                                                searchParams,
                                            }),
                                        inner,
                                    );
                                }
                                return inner();
                            };
                        })(),
                    );
                }
            }
            const [childrenRendered] = await Promise.all(slotPromises);

            // Deferred layout loader: stream its data in under <Suspense>,
            // matching the page-level pattern. Falls back to the route's own
            // loading.tsx/error.tsx (layouts have no per-node equivalent).
            const deferredLayoutPromise = deferredLoaderData.get(
                layout.manifestPath,
            );
            if (deferredLayoutPromise) {
                let LoadingFallback: ComponentFn | null = null;
                let LayoutError: ComponentFn | null = null;
                // Independent of each other — run concurrently, still pushed
                // to `assets` in the same (loading, then error) order.
                const [loadingFetch, errorFetch] = await Promise.all([
                    entry.loadingPage
                        ? Promise.all([
                              getCachedAssets(
                                  clientManifest,
                                  `${entry.loadingPage.page.src}&pick=$css`,
                              ),
                              getCachedModule<PageModule>(
                                  entry.loadingPage.page,
                              ),
                          ])
                        : Promise.resolve(null),
                    entry.errorPage
                        ? Promise.all([
                              getCachedAssets(
                                  clientManifest,
                                  `${entry.errorPage.page.src}&pick=$css`,
                              ),
                              getCachedModule<PageModule>(entry.errorPage.page),
                          ])
                        : Promise.resolve(null),
                ]);
                if (loadingFetch) {
                    const [loadingAssets, loadingModule] = loadingFetch;
                    assets.push(...(loadingAssets as RenderAsset[]));
                    LoadingFallback = loadingModule.default;
                }
                if (errorFetch) {
                    const [errorAssets, errorModule] = errorFetch;
                    assets.push(...(errorAssets as RenderAsset[]));
                    LayoutError = errorModule.default;
                }
                return () => {
                    const resource = createDeferredResource(
                        deferredLayoutPromise,
                    );
                    const inner = () =>
                        createComponent(Suspense, {
                            fallback: LoadingFallback
                                ? createComponent(LoadingFallback, {
                                      routeParams,
                                      searchParams,
                                  })
                                : undefined,
                            get children() {
                                return layoutModule({
                                    children: childrenRendered,
                                    routeParams,
                                    searchParams,
                                    loaderData: resource,
                                    slots: slots,
                                    locals: loaderInvocation.locals,
                                });
                            },
                        });
                    if (LayoutError) {
                        return idSafeErrorBoundary(
                            (err: unknown) =>
                                createComponent(LayoutError, {
                                    error: err,
                                    routeParams,
                                    searchParams,
                                }),
                            inner,
                        );
                    }
                    return inner();
                };
            }

            return () =>
                layoutModule({
                    children: childrenRendered,
                    routeParams,
                    searchParams,
                    loaderData: data,
                    slots: slots,
                    locals: loaderInvocation.locals,
                });
        },
        async () => {
            // `pageToRender` is the selected variant for `toRender`; for every
            // value reaching `compose()` the corresponding node exists, so the
            // non-null assertions below are compile-time only (no runtime change).
            const node = pageToRender!;
            const moduleSrc = `${node.page.src}&pick=$css`;
            // Only Promise.all the generateMeta fetch in when it actually
            // exists — see the matching comment on the layout closure above.
            let moduleAssets: unknown[];
            let page: ComponentFn;
            let generateMeta: MetaModule['generateMeta'] | null;
            if (node.generateMeta) {
                const [assetsResult, pageResult, metaModuleResult] =
                    await Promise.all([
                        getCachedAssets(clientManifest, moduleSrc),
                        getCachedModule<PageModule>(node.page),
                        getCachedModule<MetaModule>(node.generateMeta),
                    ]);
                moduleAssets = assetsResult;
                page = pageResult.default;
                generateMeta = metaModuleResult.generateMeta;
            } else {
                const [assetsResult, pageResult] = await Promise.all([
                    getCachedAssets(clientManifest, moduleSrc),
                    getCachedModule<PageModule>(node.page),
                ]);
                moduleAssets = assetsResult;
                page = pageResult.default;
                generateMeta = null;
            }
            assets.push(...(moduleAssets as RenderAsset[]));

            let data: unknown = {};
            if (resolvedLoaderData.has(node.manifestPath)) {
                data = resolvedLoaderData.get(node.manifestPath);
                loaderData[node.manifestPath] = data;
            }
            if (generateMeta) {
                const metaData = await generateMeta({
                    req,
                    cspNonce,
                });
                if (metaData) {
                    meta = {
                        ...meta,
                        ...metaData,
                    };
                }
            }
            const props: Record<string, unknown> = {
                routeParams,
                searchParams,
                loaderData: data,
                locals: loaderInvocation.locals,
            };
            if (toRender === 'error') {
                props.error = error;
            }

            // Deferred page loader: stream its data in under <Suspense> instead
            // of blocking the shell. `loading.tsx` (if present) is the fallback.
            const deferredPromise = deferredLoaderData.get(node.manifestPath);
            if (deferredPromise) {
                let LoadingFallback: ComponentFn | null = null;
                let PageError: ComponentFn | null = null;
                // Independent of each other — run concurrently, still pushed
                // to `assets` in the same (loading, then error) order.
                const [loadingFetch, errorFetch] = await Promise.all([
                    entry.loadingPage
                        ? Promise.all([
                              getCachedAssets(
                                  clientManifest,
                                  `${entry.loadingPage.page.src}&pick=$css`,
                              ),
                              getCachedModule<PageModule>(
                                  entry.loadingPage.page,
                              ),
                          ])
                        : Promise.resolve(null),
                    entry.errorPage
                        ? Promise.all([
                              getCachedAssets(
                                  clientManifest,
                                  `${entry.errorPage.page.src}&pick=$css`,
                              ),
                              getCachedModule<PageModule>(entry.errorPage.page),
                          ])
                        : Promise.resolve(null),
                ]);
                if (loadingFetch) {
                    const [loadingAssets, loadingModule] = loadingFetch;
                    assets.push(...(loadingAssets as RenderAsset[]));
                    LoadingFallback = loadingModule.default;
                }
                if (errorFetch) {
                    const [errorAssets, errorModule] = errorFetch;
                    assets.push(...(errorAssets as RenderAsset[]));
                    PageError = errorModule.default;
                }
                return () => {
                    const resource = createDeferredResource(deferredPromise);
                    const inner = () =>
                        createComponent(Suspense, {
                            fallback: LoadingFallback
                                ? createComponent(LoadingFallback, {
                                      routeParams,
                                      searchParams,
                                  })
                                : undefined,
                            get children() {
                                return page({
                                    ...props,
                                    loaderData: resource,
                                });
                            },
                        });
                    if (PageError) {
                        return idSafeErrorBoundary(
                            (err: unknown) =>
                                createComponent(PageError, {
                                    error: err,
                                    routeParams,
                                    searchParams,
                                }),
                            inner,
                        );
                    }
                    return inner();
                };
            }
            return () => page(props);
        },
    );

    const composed = await compose();

    // Deferred route: hand the composed tree back to the caller to stream via
    // `renderToStream` (the page suspends on its deferred resource). Streamed
    // responses are not page-cached. `meta`/`assets` are fully populated by the
    // awaited `compose()` above, so the caller can emit the <head> first.
    // PPR renders a synchronous shell (holes stay pending → fallback) via
    // renderToString below; it does NOT stream. Other deferred routes stream.
    if ((hasDeferred || hasStreamingGroup) && toRender === 'main' && !isPPR) {
        return {
            deferred: true as const,
            composed,
            documentMeta: meta,
            documentAssets: assets,
            loaderData,
            deferredKeys: [...deferredLoaderData.keys()],
        };
    }

    const rendered = await renderToString(() => composed());

    // PPR shell: return the shell HTML plus the hole manifest paths so the
    // handler can tell the client which holes to fetch and fill.
    if (isPPR && toRender === 'main') {
        return {
            rendered,
            documentMeta: meta,
            documentAssets: assets,
            loaderData,
            pprHoles: [...deferredLoaderData.keys()],
        };
    }

    if (toRender === 'main' && shouldCache) {
        const options = pageOptions?.cache as CacheOptions | undefined;
        await setCacheWithOptions(
            cacheKey,
            {
                rendered: rendered,
                documentMeta: meta,
                documentAssets: assets,
                loaderData: loaderData,
            },
            {
                ttl: options?.ttl ? options.ttl : 0,
                swr: options?.swr,
                tags: options?.tags,
            },
        );
    }

    return {
        rendered: rendered,
        documentMeta: meta,
        documentAssets: assets,
        loaderData: loaderData,
        cacheStatus: toRender === 'main' ? 'miss' : undefined,
    };
}

// Whether a matched page route needs the streaming (renderToStream) path: the
// page or a layout loader is deferred, or any parallel-route group has a
// loading/error boundary or a deferred loader. Loader modules are cached, so
// imports are cheap.
const computeNeedsStreaming = async (
    entry: RoutePageHandler,
): Promise<boolean> => {
    const pageLoader = entry.mainPage.loader;
    if (pageLoader) {
        const { loader: loaderFn } =
            await getCachedModule<LoaderModule>(pageLoader);
        if (loaderFn?.options?.type === 'defer') return true;
    }
    for (const layout of entry.layouts) {
        if (!layout.loader) continue;
        const { loader: loaderFn } = await getCachedModule<LoaderModule>(
            layout.loader,
        );
        if (loaderFn?.options?.type === 'defer') return true;
    }
    for (const group of Object.values(entry.groups || {})) {
        if (group.loadingPage || group.errorPage) return true;
        if (group.loader) {
            const { loader: loaderFn } = await getCachedModule<LoaderModule>(
                group.loader,
            );
            if (loaderFn?.options?.type === 'defer') return true;
        }
    }
    return false;
};

// A route's defer-ness is fixed once its loaders are authored — cache the
// answer per route-handler identity so a request never re-walks and
// re-imports every loader module just to re-derive a static fact (skipped in
// dev, matching `getCachedModule`'s HMR discipline; a WeakMap also means a
// route manifest rebuilt in dev never needs explicit invalidation).
const streamingCache = new WeakMap<RoutePageHandler, boolean>();

export const routeNeedsStreaming = async (
    entry: RoutePageHandler,
): Promise<boolean> => {
    /* v8 ignore next 3 -- prod-only cache hit path; covered by the
       kitchen-sink e2e suite's deferred/group-boundary specs. */
    if (!import.meta.env.DEV && streamingCache.has(entry)) {
        return streamingCache.get(entry)!;
    }
    const result = await computeNeedsStreaming(entry);
    if (!import.meta.env.DEV) {
        streamingCache.set(entry, result);
    }
    return result;
};
