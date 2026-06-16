import {
    type H3Event,
    getResponseStatus,
    setHeader,
    setResponseStatus,
} from 'vinxi/http';
import { renderToStream } from 'solid-js/web';
import type { Meta } from '../utils/meta';
import { RedirectError } from '../utils/redirect';
import { escapeScript } from '../utils/escape';
import { logger } from '../utils/logger';
import {
    renderDevOverlayDocument,
    devOverlayClientScript,
} from '../utils/dev-overlay';
import {
    renderAssetsToHtml,
    jsonForScript,
    buildHydrationScript,
    buildHeadHtml,
    createBaseMeta,
} from '../utils/html';
import { buildLoadingSwapScript } from '../utils/loading-swap';
import {
    matchRoute,
    type Import,
    type RouteHandler,
    type RoutePageHandler,
    type RouteNode,
    type SearchParams,
} from '../utils/path-router';
import {
    getInstrumentation,
    safeExecuteHook,
    createRequestContext,
    createResponseContext,
} from '../utils/instrumentation';
import { getCachedModule } from './route-manifest';
import { serveIsr } from './isr';
import { render, routeNeedsStreaming, template } from './render';
import type {
    OptionsModule,
    RenderDeferredResult,
    RenderPlainResult,
    RenderPprResult,
} from './types';

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
    });
    await safeExecuteHook('onRequest', inst?.onRequest, req, reqCtx);

    // ISR: serve a cached full-HTML artifact with stale-while-revalidate.
    // Skipped in dev and for self-fetch/crawler requests (bypass header), so
    // those render fresh through the normal path below.
    if (
        matched &&
        matched.type === 'page' &&
        !import.meta.env.DEV &&
        !isrBypass
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
            const isrHtml = await serveIsr(
                urlObj.origin,
                pathnamePart,
                revalidate,
                pageOptions.cache?.tags,
            );
            setHeader('Content-Type', 'text/html');
            setHeader(
                'Cache-Control',
                `public, max-age=0, s-maxage=${revalidate}, stale-while-revalidate`,
            );
            setResponseStatus(200);
            const respCtx = createResponseContext(reqCtx, 200);
            await safeExecuteHook(
                'onResponseEnd',
                inst?.onResponseEnd,
                req,
                respCtx,
            );
            return isrHtml;
        }
    }

    let loading = false;
    let html: string | undefined = undefined;
    let meta: Meta = createBaseMeta();
    const assets =
        await clientManifest!.inputs[clientManifest!.handler].assets();
    const entryPath =
        clientManifest!.inputs[clientManifest!.handler].output.path;
    // The dev-only suffix injects the client error-overlay runtime into
    // every page (tree-shaken from prod, where `import.meta.env.DEV` is false).
    const manifestHtml = `<script ${cspNonce ? `nonce="${cspNonce}"` : ''}>window.manifest=${escapeScript(JSON.stringify(await clientManifest!.json()))}</script>${import.meta.env.DEV ? devOverlayClientScript(cspNonce) : ''}`;

    let clientHydrationScript: string | undefined = undefined;

    setHeader('Content-Type', 'text/html');
    setHeader('Cache-Control', 'no-cache');

    const stream = new ReadableStream({
        async start(controller) {
            const encoder = new TextEncoder();
            const push = (text: string) =>
                controller.enqueue(encoder.encode(text));
            let streamError: unknown = null;

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
                            } = (await render({
                                toRender: 'not-found',
                                entry: notFoundEntry as RoutePageHandler,
                                routeParams: {},
                                searchParams: {},
                                req: req,
                                pageOptions: {},
                                cspNonce,
                                locals,
                            })) as RenderPlainResult;
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
                            push('Not Found');
                            controller.close();
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

                        // PPR: render and serve the static shell (deferred
                        // holes left as their loading fallback). The client
                        // fills the holes by fetching their loader data. The
                        // build crawler captures this shell as a .html
                        // artifact; dev and prod-fallback both render here.
                        if (options?.render === 'ppr') {
                            const result = (await render({
                                toRender: 'main',
                                entry: pageEntry!,
                                routeParams: params,
                                searchParams,
                                req,
                                pageOptions: options,
                                cspNonce,
                                locals,
                            })) as RenderPprResult;
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
                            });
                            setResponseStatus(200);
                            push(
                                `<!doctype html><html lang="en"><head>${headHtml}</head>${result.rendered}${manifestHtml}${mainScript}</html>`,
                            );
                            controller.close();
                            return;
                        }

                        // Deferred route: stream the shell immediately and
                        // stream deferred loader data in afterwards via Solid's
                        // renderToStream + Suspense. Non-deferred routes fall
                        // through to the unchanged renderToString path below.
                        if (await routeNeedsStreaming(pageEntry!)) {
                            const result = (await render({
                                toRender: 'main',
                                entry: pageEntry!,
                                routeParams: params,
                                searchParams,
                                req,
                                pageOptions: options,
                                cspNonce,
                                locals,
                            })) as RenderDeferredResult;
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
                            });
                            setResponseStatus(200);
                            push(
                                `<!doctype html><html lang="en"><head>${headHtml}</head>`,
                            );
                            await new Promise<void>((resolve) => {
                                // The runtime `pipe(writable)` calls
                                // `writable.write()` for chunks and
                                // `writable.end()` on completion, and the
                                // options accept `onError` — both wider than
                                // the published types, hence the casts.
                                const { pipe } = renderToStream(
                                    () => result.composed(),
                                    {
                                        nonce: cspNonce,
                                        onError(e: any) {
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
                            controller.close();
                            return;
                        }
                        try {
                            if (!pageEntry!.loadingPage) {
                                throw new Error('No loading page');
                            }
                            const { rendered, documentMeta, documentAssets } =
                                (await render({
                                    toRender: 'loading',
                                    entry: pageEntry!,
                                    routeParams: params,
                                    searchParams,
                                    req: req,
                                    pageOptions: options,
                                    cspNonce,
                                    locals,
                                })) as RenderPlainResult;
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

                        const {
                            rendered,
                            documentMeta,
                            documentAssets,
                            loaderData,
                        } = (await render({
                            toRender: 'main',
                            entry: pageEntry!,
                            routeParams: params,
                            searchParams,
                            req: req,
                            pageOptions: options,
                            cspNonce,
                            locals,
                        })) as RenderPlainResult;
                        assets.push(...documentAssets);
                        clientHydrationScript = buildHydrationScript({
                            entryPath,
                            manifestPath: pageEntry!.mainPage.manifestPath,
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
                        setResponseStatus(200);
                    }
                } catch (e1: any) {
                    streamError = e1;
                    if (
                        e1 instanceof RedirectError ||
                        e1.name === 'RedirectError'
                    ) {
                        setHeader('Location', e1.message);
                        setResponseStatus(302);
                        controller.close();
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
                                push(
                                    renderDevOverlayDocument(e1, {
                                        method: req.method,
                                        url: req.url,
                                    }),
                                );
                                controller.close();
                                return;
                            }
                            throw e1;
                        }
                        const {
                            rendered,
                            documentMeta,
                            documentAssets,
                            loaderData,
                        } = (await render({
                            toRender: 'error',
                            entry: pageEntry!,
                            routeParams: params,
                            searchParams,
                            req: req,
                            pageOptions: {},
                            cspNonce,
                            locals,
                            error: e1,
                        })) as RenderPlainResult;
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
                        throw e1;
                    }
                }

                if (loading) {
                    const assetsHtml = renderAssetsToHtml(
                        assets,
                        cspNonce,
                        false,
                    );
                    push(`<template id="__page_html__">${html}</template>`);
                    push(buildLoadingSwapScript(meta, assetsHtml, cspNonce));
                    push(manifestHtml);
                    push(clientHydrationScript);
                    controller.close();
                    return;
                }
                const assetsHtml = renderAssetsToHtml(assets, cspNonce);
                const transformHtml = template
                    .replace(
                        '<!--app-head-->',
                        buildHeadHtml(meta, assetsHtml, cspNonce),
                    )
                    .replace(
                        '<!--app-body-->',
                        (html ?? '') + manifestHtml + clientHydrationScript,
                    );
                push(transformHtml);
                controller.close();
                return;
            } catch (error) {
                streamError = streamError ?? error;
                throw error;
            } finally {
                const statusCode = getResponseStatus(event) || 200;
                const respCtx = createResponseContext(reqCtx, statusCode);
                await safeExecuteHook(
                    'onResponseEnd',
                    inst?.onResponseEnd,
                    req,
                    respCtx,
                );
                if (streamError) {
                    await safeExecuteHook(
                        'onRequestError',
                        inst?.onRequestError as any,
                        streamError,
                        req,
                        reqCtx,
                    );
                }
            }
        },
    });
    return stream;
};
