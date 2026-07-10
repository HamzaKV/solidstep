import {
    type H3Event,
    getResponseStatus,
    setHeader,
    setResponseStatus,
} from 'vinxi/http';
import { renderToStream } from 'solid-js/web';
import type { Meta } from '../utils/meta.js';
import { RedirectError } from '../utils/redirect.js';
import { escapeScript } from '../utils/escape.js';
import { logger } from '../utils/logger.js';
import {
    renderDevOverlayDocument,
    devOverlayClientScript,
} from '../utils/dev-overlay.js';
import {
    renderAssetsToHtml,
    jsonForScript,
    buildHydrationScript,
    buildHeadHtml,
    createBaseMeta,
} from '../utils/html.js';
import { buildLoadingSwapScript } from '../utils/loading-swap.js';
import {
    matchRoute,
    type Import,
    type RouteHandler,
    type RoutePageHandler,
    type RouteNode,
    type SearchParams,
} from '../utils/path-router.js';
import {
    getInstrumentation,
    safeExecuteHook,
    createRequestContext,
    createResponseContext,
} from '../utils/instrumentation.js';
import { getCachedModule } from './route-manifest.js';
import { serveIsr } from './isr.js';
import { isPreviewActive } from '../utils/preview.js';
import { render, routeNeedsStreaming, template } from './render.js';
import { isDeferredResult, isPprResult } from './types.js';
import type { OptionsModule, RenderAsset } from './types.js';

// The escaped client-manifest JSON payload embedded in every document is
// static once the app is built — cache it in prod (skipped in dev so a
// changed manifest under HMR is reflected immediately, same discipline as
// `getCachedModule` in `./route-manifest.js`). Only the JSON blob is cached;
// the surrounding `<script>` tag (which carries the per-request CSP nonce)
// is still built fresh every time.
let manifestJsonCache: string | null = null;
const getManifestJson = async (
    clientManifest: PageRenderContext['clientManifest'],
): Promise<string> => {
    /* v8 ignore next 3 -- prod-only cache hit path; covered by the
       kitchen-sink e2e suite's production build (CSP/manifest specs). */
    if (!import.meta.env.DEV && manifestJsonCache !== null) {
        return manifestJsonCache;
    }
    const json = escapeScript(JSON.stringify(await clientManifest.json()));
    if (!import.meta.env.DEV) {
        manifestJsonCache = json;
    }
    return json;
};

/**
 * Everything the page-render pipeline needs from the request handler. The
 * top-level handler (`server.ts`) stays a thin router: it matches the route,
 * resolves these request-scoped values, and delegates the entire page/not-found
 * render — ISR short-circuit, PPR shell, deferred streaming, loading boundary,
 * main render, error boundary, and response assembly — to {@link renderPage}.
 */
export type PageRenderContext = {
    event: H3Event;
    req: Request;
    matched: RouteHandler | undefined;
    pageEntry: RoutePageHandler | undefined;
    params: Record<string, string | string[]>;
    searchParams: SearchParams;
    pathnamePart: string;
    urlObj: URL;
    isrBypass: boolean;
    locals: Record<string, unknown> | undefined;
    cspNonce: string | undefined;
    clientManifest: ReturnType<
        typeof import('./route-manifest').ensureClientManifest
    >;
    routeManifest: RouteNode;
};

/**
 * Render a matched page (or the not-found page) and return the HTTP body —
 * either a streamed `ReadableStream` (the common path) or a cached ISR HTML
 * string. Instrumentation `onRequest` / `onResponseEnd` / `onRequestError`
 * hooks fire around the render. Extracted from `server.ts` so the handler reads
 * as a thin request router; behavior is unchanged.
 */
export const renderPage = async (ctx: PageRenderContext) => {
    const {
        event,
        req,
        matched,
        pageEntry,
        params,
        searchParams,
        pathnamePart,
        urlObj,
        isrBypass,
        locals,
        cspNonce,
        clientManifest,
        routeManifest,
    } = ctx;

    const inst = getInstrumentation();
    const reqCtx = createRequestContext(req, {
        routePath: matched ? pathnamePart : '/not-found',
        routeType: matched ? 'page' : 'not-found',
        params,
        searchParams,
        pathname: pathnamePart,
    });
    await safeExecuteHook('onRequest', inst?.onRequest, req, reqCtx);

    // ISR: serve a cached full-HTML artifact with stale-while-revalidate.
    // Skipped in dev, for self-fetch/crawler requests (bypass header), and
    // when preview mode is active, so those render fresh through the normal
    // path below.
    if (
        matched &&
        matched.type === 'page' &&
        !import.meta.env.DEV &&
        !isrBypass &&
        !isPreviewActive()
    ) {
        const optionsImport = pageEntry!.mainPage.options;
        const pageOptions = optionsImport
            ? (await getCachedModule<OptionsModule>(optionsImport)).options
            : undefined;
        if (pageOptions?.render === 'isr') {
            reqCtx.metadata.renderStrategy = 'isr';
            const revalidate =
                pageOptions.revalidate && pageOptions.revalidate > 0
                    ? pageOptions.revalidate
                    : 60;
            const isr = await serveIsr(
                urlObj.origin,
                pathnamePart,
                revalidate,
                pageOptions.cache?.tags,
            );
            reqCtx.metadata.cacheStatus = isr.cacheStatus;
            setHeader('Content-Type', 'text/html');
            setHeader(
                'Cache-Control',
                `public, max-age=0, s-maxage=${revalidate}, stale-while-revalidate=${revalidate}`,
            );
            setResponseStatus(200);
            if (inst?.onResponseStart || inst?.onResponseEnd) {
                const respCtx = createResponseContext(reqCtx, 200);
                await safeExecuteHook(
                    'onResponseStart',
                    inst?.onResponseStart,
                    req,
                    respCtx,
                );
                await safeExecuteHook(
                    'onResponseEnd',
                    inst?.onResponseEnd,
                    req,
                    respCtx,
                );
            }
            return isr.html;
        }
    }

    let loading = false;
    let html: string | undefined;
    let hydrationDisabled = false;
    let meta: Meta = createBaseMeta();
    // Deliberately NOT routed through getCachedAssets: benchmarked and found
    // ~2.5x slower for this specific call (measured via before/after +
    // bisection across commits: reverting just this one line recovered, and
    // even exceeded, pre-caching throughput on plain dynamic pages, while
    // getCachedAssets is a genuine win for the per-node calls in render.ts).
    // vinxi's `manifest.inputs[...]` is a Proxy whose `assets()` is already
    // synchronous and cheap for the client entry; caching it here traded a
    // fast direct call for slower Map-wrapped indirection.
    const assets = (await clientManifest!.inputs[
        clientManifest!.handler
    ].assets()) as RenderAsset[];
    const entryPath =
        clientManifest!.inputs[clientManifest!.handler].output.path;
    // The dev-only suffix injects the client error-overlay runtime into
    // every page (tree-shaken from prod, where `import.meta.env.DEV` is false).
    const manifestHtml = `<script ${cspNonce ? `nonce="${cspNonce}"` : ''}>window.manifest=${await getManifestJson(clientManifest!)}</script>${import.meta.env.DEV ? devOverlayClientScript(cspNonce) : ''}`;

    let clientHydrationScript: string | undefined;

    setHeader('Content-Type', 'text/html');
    setHeader('Cache-Control', 'no-cache');

    // Client-disconnect handling: `cancel()` flips the flag (turning every
    // later `push`/`close` into a no-op) and unblocks the deferred branch's
    // pipe-completion promise so `start` can finish and the `finally`
    // (onResponseEnd/onRequestError) still runs instead of hanging forever.
    let streamCancelled = false;
    let unblockOnCancel: (() => void) | null = null;
    const stream = new ReadableStream({
        async start(controller) {
            const encoder = new TextEncoder();
            const push = (text: string) => {
                if (streamCancelled) return;
                controller.enqueue(encoder.encode(text));
            };
            const close = () => {
                if (!streamCancelled) controller.close();
            };
            let streamError: unknown = null;
            // Fired once per response, right after status/headers are final
            // but before the first body byte — across whichever of the
            // branches below (ISR, PPR, deferred, loading-swap, main, error,
            // 404, dev-overlay) ends up producing the response.
            const fireResponseStart = () => {
                if (!inst?.onResponseStart) return undefined;
                return safeExecuteHook(
                    'onResponseStart',
                    inst.onResponseStart,
                    req,
                    createResponseContext(
                        reqCtx,
                        getResponseStatus(event) || 200,
                    ),
                );
            };

            try {
                try {
                    if (!matched) {
                        try {
                            // Non-null assertion is compile-time only:
                            // a missing match throws the same way the
                            // previous `match.handler` access did (the
                            // outer catch maps it to a 404).
                            const match = matchRoute(routeManifest, '/')!;
                            const notFoundEntry = match.handler;
                            if (!notFoundEntry) {
                                throw new Error('No not-found page configured');
                            }
                            const {
                                rendered,
                                documentMeta,
                                documentAssets,
                                loaderData,
                            } = await render({
                                toRender: 'not-found',
                                entry: notFoundEntry as RoutePageHandler,
                                routeParams: {},
                                searchParams: {},
                                req: req,
                                pageOptions: {},
                                cspNonce,
                                locals,
                                url: urlObj,
                            });
                            assets.push(...documentAssets);
                            clientHydrationScript = buildHydrationScript({
                                entryPath,
                                manifestPath: '/not-found/',
                                params,
                                searchParams,
                                loaderData,
                                nonce: cspNonce,
                            });
                            html = rendered;
                            meta = {
                                ...meta,
                                ...documentMeta,
                            };
                            setResponseStatus(404);
                        } catch (e) {
                            console.error('404 module not found:', e);
                            setResponseStatus(404);
                            await fireResponseStart();
                            push('Not Found');
                            close();
                            return;
                        }
                    } else {
                        const { options } = pageEntry!.mainPage.options
                            ? await getCachedModule<OptionsModule>(
                                  pageEntry!.mainPage.options as Import,
                              )
                            : { options: {} };
                        reqCtx.metadata.renderStrategy =
                            options?.render ?? 'dynamic';
                        if (options?.responseHeaders) {
                            const headers = options.responseHeaders;
                            for (const [key, value] of Object.entries(
                                headers,
                            )) {
                                setHeader(key, value);
                            }
                        }

                        // hydration.disable ships zero framework JS for a
                        // plain synchronous render; it can't coexist with a
                        // PPR shell, a deferred/streamed render, or a
                        // loading.tsx swap (all three need the client runtime
                        // to fill holes / swap content in). Compute once here
                        // so every branch below sees a consistent decision.
                        const needsStreaming =
                            options?.render !== 'ppr' &&
                            (await routeNeedsStreaming(pageEntry!));
                        if (
                            options?.hydration?.disable &&
                            (options?.render === 'ppr' ||
                                needsStreaming ||
                                pageEntry!.loadingPage)
                        ) {
                            logger.warn(
                                { route: pathnamePart },
                                'hydration.disable is incompatible with render: "ppr", a deferred loader, or a sibling loading.tsx; ignored for this render',
                            );
                        } else {
                            hydrationDisabled = !!options?.hydration?.disable;
                        }

                        // PPR: render and serve the static shell (deferred
                        // holes left as their loading fallback). The client
                        // fills the holes by fetching their loader data. The
                        // build crawler captures this shell as a .html
                        // artifact; dev and prod-fallback both render here.
                        if (options?.render === 'ppr') {
                            const result = await render({
                                toRender: 'main',
                                entry: pageEntry!,
                                routeParams: params,
                                searchParams,
                                req,
                                pageOptions: options,
                                cspNonce,
                                locals,
                                url: urlObj,
                            });
                            if (!isPprResult(result)) {
                                throw new Error('Expected a PPR render result');
                            }
                            const assetsHtml = renderAssetsToHtml(
                                result.documentAssets,
                                cspNonce,
                            );
                            const headHtml = buildHeadHtml(
                                { ...meta, ...result.documentMeta },
                                assetsHtml,
                                cspNonce,
                            );
                            // Trailing `true` flags PPR so the client fetches
                            // each hole's loader data instead of waiting for
                            // streamed hydration.
                            const mainScript = buildHydrationScript({
                                entryPath,
                                manifestPath: pageEntry!.mainPage.manifestPath,
                                params,
                                searchParams,
                                loaderData: result.loaderData,
                                extraArgs: [
                                    jsonForScript(result.pprHoles),
                                    'true',
                                ],
                                nonce: cspNonce,
                                fetchPriority:
                                    options?.hydration?.fetchPriority,
                            });
                            setResponseStatus(200);
                            await fireResponseStart();
                            push(
                                `<!doctype html><html lang="en"><head>${headHtml}</head>${result.rendered}${manifestHtml}${mainScript}</html>`,
                            );
                            close();
                            return;
                        }

                        // Deferred route: stream the shell immediately and
                        // stream deferred loader data in afterwards via Solid's
                        // renderToStream + Suspense. Non-deferred routes fall
                        // through to the unchanged renderToString path below.
                        if (needsStreaming) {
                            const result = await render({
                                toRender: 'main',
                                entry: pageEntry!,
                                routeParams: params,
                                searchParams,
                                req,
                                pageOptions: options,
                                cspNonce,
                                locals,
                                url: urlObj,
                            });
                            if (!isDeferredResult(result)) {
                                throw new Error(
                                    'Expected a deferred render result',
                                );
                            }
                            const assetsHtml = renderAssetsToHtml(
                                result.documentAssets,
                                cspNonce,
                            );
                            const headHtml = buildHeadHtml(
                                { ...meta, ...result.documentMeta },
                                assetsHtml,
                                cspNonce,
                            );
                            const mainScript = buildHydrationScript({
                                entryPath,
                                manifestPath: pageEntry!.mainPage.manifestPath,
                                params,
                                searchParams,
                                loaderData: result.loaderData,
                                extraArgs: [jsonForScript(result.deferredKeys)],
                                nonce: cspNonce,
                                fetchPriority:
                                    options?.hydration?.fetchPriority,
                            });
                            setResponseStatus(200);
                            await fireResponseStart();
                            push(
                                `<!doctype html><html lang="en"><head>${headHtml}</head>`,
                            );
                            await new Promise<void>((resolve) => {
                                // A client disconnect must also settle this
                                // promise (via `cancel()` below), or the
                                // request would hang until `end` — which for
                                // never-settling deferred data is never.
                                unblockOnCancel = resolve;
                                // The runtime `pipe(writable)` calls
                                // `writable.write()` for chunks and
                                // `writable.end()` on completion, and the
                                // options accept `onError` — both wider than
                                // the published types, hence the casts.
                                const { pipe } = renderToStream(
                                    () => result.composed(),
                                    {
                                        nonce: cspNonce,
                                        onError(e: unknown) {
                                            streamError = e;
                                            if (import.meta.env.DEV) {
                                                console.error(e);
                                            }
                                        },
                                    } as any,
                                );
                                pipe({
                                    write: (v: string) => push(v),
                                    end: () => {
                                        push(manifestHtml);
                                        push(mainScript);
                                        push('</html>');
                                        resolve();
                                    },
                                } as any);
                            });
                            unblockOnCancel = null;
                            close();
                            return;
                        }
                        // Only pages with a loading.tsx get the transient
                        // loading boundary; the plain-page common case skips
                        // this block entirely (no throwaway render, no warn).
                        if (pageEntry!.loadingPage) {
                            try {
                                const {
                                    rendered,
                                    documentMeta,
                                    documentAssets,
                                } = await render({
                                    toRender: 'loading',
                                    entry: pageEntry!,
                                    routeParams: params,
                                    searchParams,
                                    req: req,
                                    pageOptions: options,
                                    cspNonce,
                                    locals,
                                    url: urlObj,
                                });
                                const assetsHtml = renderAssetsToHtml(
                                    assets.concat(documentAssets),
                                    cspNonce,
                                );
                                const html = `
                        <!doctype html>
                        <html lang="en">
                            <head>
                                ${buildHeadHtml(
                                    { ...meta, ...documentMeta },
                                    assetsHtml,
                                    cspNonce,
                                )}
                            </head>
                            <noscript>
                                Please enable JavaScript to view the content.<br/>
                            </noscript>
                            ${rendered}
                        </html>
                        `;
                                push(html);
                                // The loading boundary is a transient,
                                // server-rendered placeholder shown until the
                                // main content streams in and replaces it; it
                                // is intentionally NOT hydrated. (Hydrating it
                                // would render the real page with no loader
                                // data and race the main hydration below.)
                                loading = true;
                            } catch (e) {
                                // The loading boundary failed to render; we
                                // still proceed to render the main page, but
                                // surface this so authors notice a broken
                                // loading.tsx.
                                logger.warn(
                                    {
                                        route: pathnamePart,
                                        err: String(e),
                                    },
                                    'Failed to render loading boundary (loading.tsx)',
                                );
                            }
                        }

                        const mainResult = await render({
                            toRender: 'main',
                            entry: pageEntry!,
                            routeParams: params,
                            searchParams,
                            req: req,
                            pageOptions: options,
                            cspNonce,
                            locals,
                            url: urlObj,
                        });
                        if (
                            isDeferredResult(mainResult) ||
                            isPprResult(mainResult)
                        ) {
                            throw new Error('Expected a plain render result');
                        }
                        reqCtx.metadata.cacheStatus = mainResult.cacheStatus;
                        const {
                            rendered,
                            documentMeta,
                            documentAssets,
                            loaderData,
                        } = mainResult;
                        assets.push(...documentAssets);
                        if (!hydrationDisabled) {
                            clientHydrationScript = buildHydrationScript({
                                entryPath,
                                manifestPath: pageEntry!.mainPage.manifestPath,
                                params,
                                searchParams,
                                loaderData,
                                nonce: cspNonce,
                                fetchPriority:
                                    options?.hydration?.fetchPriority,
                            });
                        }
                        html = rendered;
                        meta = {
                            ...meta,
                            ...documentMeta,
                        };
                        setResponseStatus(200);
                    }
                } catch (e1: any) {
                    // Any error path (including a broken error.tsx) resumes
                    // normal hydration: hydration.disable only ever applies
                    // to a genuinely successful plain main render.
                    hydrationDisabled = false;
                    streamError = e1;
                    if (
                        e1 instanceof RedirectError ||
                        e1.name === 'RedirectError'
                    ) {
                        setHeader('Location', e1.message);
                        setResponseStatus((e1 as RedirectError).status ?? 302);
                        close();
                        return;
                    }
                    if (import.meta.env.DEV) {
                        console.error(e1);
                    }
                    try {
                        const errorPage = pageEntry!.errorPage;
                        if (!errorPage) {
                            // Dev: show the error overlay for an
                            // unhandled render error (no error.tsx).
                            // Prod: rethrow → the outer 500.
                            if (import.meta.env.DEV) {
                                setResponseStatus(500);
                                await fireResponseStart();
                                push(
                                    renderDevOverlayDocument(e1, {
                                        method: req.method,
                                        url: req.url,
                                    }),
                                );
                                close();
                                return;
                            }
                            throw e1;
                        }
                        const {
                            rendered,
                            documentMeta,
                            documentAssets,
                            loaderData,
                        } = await render({
                            toRender: 'error',
                            entry: pageEntry!,
                            routeParams: params,
                            searchParams,
                            req: req,
                            pageOptions: {},
                            cspNonce,
                            locals,
                            error: e1,
                            url: urlObj,
                        });
                        assets.push(...documentAssets);
                        clientHydrationScript = buildHydrationScript({
                            entryPath,
                            manifestPath: errorPage.manifestPath,
                            params,
                            searchParams,
                            loaderData,
                            nonce: cspNonce,
                        });
                        html = rendered;
                        meta = {
                            ...meta,
                            ...documentMeta,
                        };
                        // statusCode = 500;
                        setResponseStatus(500);
                    } catch (e2) {
                        // The error boundary (error.tsx) itself failed to
                        // render while handling e1 — log it so authors don't
                        // lose the reason error.tsx never rendered, then
                        // propagate the original error unchanged.
                        logger.error(
                            {
                                route: pathnamePart,
                                err: String(e2),
                            },
                            'Failed to render error boundary (error.tsx)',
                        );
                        throw e1;
                    }
                }

                await fireResponseStart();

                if (loading) {
                    const assetsHtml = renderAssetsToHtml(
                        assets,
                        cspNonce,
                        false,
                    );
                    push(`<template id="__page_html__">${html}</template>`);
                    push(buildLoadingSwapScript(meta, assetsHtml, cspNonce));
                    push(manifestHtml);
                    push(clientHydrationScript ?? '');
                    close();
                    return;
                }
                // hydration.disable: ship no client-manifest script, no
                // module-preload links, and no Solid hydration bootstrap —
                // true zero framework JS for this response.
                const bodyAssets = hydrationDisabled
                    ? assets.filter(
                          (a) =>
                              !(
                                  a.tag === 'link' &&
                                  a.attrs.rel === 'modulepreload'
                              ),
                      )
                    : assets;
                const assetsHtml = renderAssetsToHtml(bodyAssets, cspNonce);
                const transformHtml = template
                    .replace(
                        '<!--app-head-->',
                        buildHeadHtml(
                            meta,
                            assetsHtml,
                            cspNonce,
                            !hydrationDisabled,
                        ),
                    )
                    .replace(
                        '<!--app-body-->',
                        (html ?? '') +
                            (hydrationDisabled
                                ? ''
                                : manifestHtml + (clientHydrationScript ?? '')),
                    );
                push(transformHtml);
                close();
                return;
            } catch (error) {
                streamError = streamError ?? error;
                throw error;
            } finally {
                if (inst?.onResponseEnd) {
                    const statusCode = getResponseStatus(event) || 200;
                    const respCtx = createResponseContext(reqCtx, statusCode);
                    await safeExecuteHook(
                        'onResponseEnd',
                        inst.onResponseEnd,
                        req,
                        respCtx,
                    );
                }
                if (streamError) {
                    await safeExecuteHook(
                        'onRequestError',
                        inst?.onRequestError,
                        streamError instanceof Error
                            ? streamError
                            : new Error(String(streamError)),
                        req,
                        reqCtx,
                    );
                }
            }
        },
        cancel() {
            streamCancelled = true;
            unblockOnCancel?.();
        },
    });
    return stream;
};
