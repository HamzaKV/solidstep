import {
    eventHandler,
    getResponseStatus,
    toWebRequest,
    setHeader,
    setResponseStatus,
} from 'vinxi/http';
import { renderToStream } from 'solid-js/web';
import type { Meta } from './utils/meta';
import { RedirectError } from './utils/redirect';
import { setCacheStore } from './utils/cache';
import { MemoryCacheStore, FilesystemCacheStore } from './utils/cache-store';
import { handleServerFunction } from './utils/server-action.server';
import { escapeScript } from './utils/escape';
import { logger } from './utils/logger';
import {
    renderDevOverlayDocument,
    devOverlayClientScript,
} from './utils/dev-overlay';
import {
    renderAssetsToHtml,
    jsonForScript,
    buildHydrationScript,
    buildHeadHtml,
    createBaseMeta,
} from './utils/html';
import { buildLoadingSwapScript } from './utils/loading-swap';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    matchRoute,
    parseSearchParams,
    type Import,
    type RouteHandler,
    type RoutePageHandler,
    type SearchParams,
} from './utils/path-router';
import {
    loadInstrumentation,
    getInstrumentation,
    safeExecuteHook,
    createRequestContext,
    createResponseContext,
} from './utils/instrumentation';
import {
    createRouteManifest,
    collectPrerenderTargets,
    ensureRouteManifest,
    setRouteManifest,
    getMetadataManifest,
    ensureClientManifest,
    getCachedModule,
} from './server/route-manifest';
import { serveHoleData, serveRouteData } from './server/data-endpoints';
import { serveIsr, seedIsrFromManifest } from './server/isr';
import { render, routeNeedsStreaming, template } from './server/render';
import type {
    OptionsModule,
    RenderDeferredResult,
    RenderPlainResult,
    RenderPprResult,
    RouteApiModule,
    RouteMethodHandler,
} from './server/types';
import {
    ISR_BYPASS_HEADER,
    PRERENDER_ENDPOINT,
    LOADER_ENDPOINT,
    ROUTE_ENDPOINT,
} from './server/constants';

/**
 * The API-route variant of a matched {@link RouteHandler} (`route.ts`). The
 * manifest also attaches a `routePath` (used for instrumentation), which the
 * shared `RouteHandler` type does not declare, so it is added here.
 */
type ApiRouteHandler = Extract<RouteHandler, { type: 'route' }> & {
    routePath?: string;
};

let instrumentationReady: Promise<void> | null = null;

const onStart = async () => {
    // The built server's `import.meta.url` is not always a usable absolute file
    // URL (notably on Windows in the Nitro bundle), so derive the server output
    // directory from the entry path (`node .output/server/index.mjs`). This is
    // where `.config.json` and `prerender-manifest.json` are written at build.
    let serverDir: string;
    try {
        serverDir = dirname(process.argv[1] || fileURLToPath(import.meta.url));
    } catch {
        serverDir = process.cwd();
    }
    try {
        const manifest = await createRouteManifest();
        setRouteManifest(manifest.rootNode, manifest.metadataMap);
        let sharedConfig = (globalThis as any).__SOLIDSTEP_CONFIG__;
        if (!sharedConfig) {
            const configContent = await readFile(
                `${serverDir}/.config.json`,
                'utf-8',
            );
            sharedConfig = JSON.parse(configContent);
            // @ts-ignore
            globalThis.__SOLIDSTEP_CONFIG__ = sharedConfig;
        }

        // Select the built-in cache backend from config. Applied before
        // instrumentation `register()` so a user `setCacheStore(...)` there
        // (e.g. a Redis adapter) can override it.
        const cacheConfig = sharedConfig?.cache as
            | { type?: 'memory'; maxEntries?: number; maxBytes?: number }
            | { type: 'filesystem'; dir: string }
            | undefined;
        if (cacheConfig?.type === 'filesystem') {
            setCacheStore(new FilesystemCacheStore({ dir: cacheConfig.dir }));
        } else if (cacheConfig?.maxEntries || cacheConfig?.maxBytes) {
            setCacheStore(
                new MemoryCacheStore({
                    maxEntries: cacheConfig.maxEntries,
                    maxBytes: cacheConfig.maxBytes,
                }),
            );
        }
    } catch (e) {
        console.error('Error creating route manifest:', e);
    }

    // Load instrumentation
    const instrumentation = await loadInstrumentation();
    if (instrumentation?.register) {
        await safeExecuteHook('register', instrumentation.register);
    }

    // Seed ISR artifacts (written by the build-time crawler) into the active
    // cache store so the first request is warm. Done after register() so a
    // user-provided store is the one being seeded.
    await seedIsrFromManifest(serverDir);
};

instrumentationReady = onStart();

/**
 * Handle a matched API route (`route.ts`): dispatch to the export matching the
 * request method and run the request/response/error instrumentation hooks.
 */
const handleApiRoute = async (
    // `event` is vinxi's H3Event, deliberately typed wider than the published
    // type (e.g. `event.locals`), matching the outer handler's usage.
    event: any,
    req: Request,
    matched: ApiRouteHandler,
    params: Record<string, string | string[]>,
    searchParams: SearchParams,
) => {
    const inst = getInstrumentation();
    const reqCtx = createRequestContext(req, {
        routePath: matched.routePath || 'unknown',
        routeType: 'api',
        params,
        searchParams,
    });
    await safeExecuteHook('onRequest', inst?.onRequest, req, reqCtx);

    try {
        const routeModule = await getCachedModule<RouteApiModule>(
            matched.handler,
        );
        const reqMethod = req.method?.toUpperCase();
        if (reqMethod) {
            const methodHandler = routeModule[reqMethod];
            if (typeof methodHandler === 'function') {
                const result = await (methodHandler as RouteMethodHandler)(
                    req,
                    {
                        params: params,
                        searchParams: searchParams,
                    },
                );
                const respCtx = createResponseContext(
                    reqCtx,
                    getResponseStatus(event) || 200,
                );
                await safeExecuteHook(
                    'onResponseEnd',
                    inst?.onResponseEnd,
                    req,
                    respCtx,
                );
                return result;
            }

            throw new Error(
                `Method ${reqMethod} not implemented in ${matched.handler.src}`,
            );
        }
        throw new Error(`Unsupported request method: ${reqMethod}`);
    } catch (error) {
        await safeExecuteHook(
            'onRequestError',
            inst?.onRequestError as any,
            error,
            req,
            reqCtx,
        );
        throw error;
    }
};

const handler = eventHandler(async (event) => {
    if (instrumentationReady) await instrumentationReady;

    const req = toWebRequest(event);

    try {
        if (
            req.url.includes(
                '/.well-known/appspecific/com.chrome.devtools.json',
            )
        ) {
            setResponseStatus(204);
            return;
        }

        if (req.url?.includes('_server')) {
            return handleServerFunction(event);
        }

        // Build-time prerender discovery. Only answered when the process was
        // started in prerender mode (the build crawler sets this env var), so it
        // is never reachable in a normal production server.
        if (
            process.env.SOLIDSTEP_PRERENDER === '1' &&
            new URL(req.url).pathname === PRERENDER_ENDPOINT
        ) {
            setHeader('Content-Type', 'application/json');
            return JSON.stringify(await collectPrerenderTargets());
        }

        const routeManifest = await ensureRouteManifest();

        const clientManifest = ensureClientManifest();

        // Request-scoped values set by middleware (`event.locals`), threaded into
        // loaders/components. The CSP nonce is the one framework-populated key.
        const locals = (event as any).locals as
            | Record<string, unknown>
            | undefined;
        const cspNonce = locals?.cspNonce as string | undefined;

        // PPR hole data: the client fetches a deferred loader's data here to fill
        // a partially-prerendered page's dynamic holes.
        if (new URL(req.url).pathname === LOADER_ENDPOINT) {
            const body = await serveHoleData(req, locals);
            if (body === null) {
                setResponseStatus(400);
                return 'Bad Request';
            }
            // seroval-serialized envelope (not JSON) — see `serveHoleData`.
            setHeader('Content-Type', 'text/plain; charset=utf-8');
            setHeader('Cache-Control', 'no-store');
            return body;
        }

        // Soft-navigation route data: the client router fetches a route's full
        // loader data + metadata here as a seroval-serialized envelope.
        if (new URL(req.url).pathname === ROUTE_ENDPOINT) {
            const body = await serveRouteData(req, cspNonce, locals);
            if (body === null) {
                setResponseStatus(400);
                return 'Bad Request';
            }
            setHeader('Content-Type', 'text/plain; charset=utf-8');
            setHeader('Cache-Control', 'no-store');
            return body;
        }

        const urlObj = new URL(req.url);
        const pathnamePart = urlObj.pathname;
        const searchParams = parseSearchParams(urlObj.searchParams);
        const isrBypass = req.headers.get(ISR_BYPASS_HEADER) === '1';

        // Dynamic metadata files (robots.txt / sitemap.xml / manifest / llms.txt).
        // A matching static file in public/ is served by the static router first.
        const metaRoute = getMetadataManifest()?.get(pathnamePart);
        if (metaRoute) {
            const mod = await getCachedModule<{
                default?: (req: Request) => unknown | Promise<unknown>;
            }>(metaRoute.handler);
            if (typeof mod.default === 'function') {
                const result = await mod.default(req);
                if (result instanceof Response) {
                    return result;
                }
                setHeader('Content-Type', metaRoute.contentType);
                return typeof result === 'string'
                    ? result
                    : JSON.stringify(result);
            }
        }

        const match = matchRoute(routeManifest, pathnamePart);
        const matched = match?.handler;
        const params = match?.params || {};

        if (matched && matched.type === 'route') {
            return handleApiRoute(event, req, matched, params, searchParams);
        }

        // API routes returned above, so any remaining match is necessarily a
        // page handler. Narrowing once here lets the render branches below use a
        // typed `pageEntry!` instead of repeating `pageEntry!`.
        const pageEntry: RoutePageHandler | undefined =
            matched?.type === 'page' ? matched : undefined;

        // Page (or not-found) render: instrumentation → ISR short-circuit →
        // streamed SSR. Scoped in a local function so the handler above reads as
        // a thin request router.
        const renderPage = async () => {
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
                    ? (await getCachedModule<OptionsModule>(optionsImport))
                          .options
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
                                    const match = matchRoute(
                                        routeManifest,
                                        '/',
                                    )!;
                                    const notFoundEntry = match.handler;
                                    if (!notFoundEntry) {
                                        throw new Error(
                                            'No not-found page configured',
                                        );
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
                                    clientHydrationScript =
                                        buildHydrationScript({
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
                                        manifestPath:
                                            pageEntry!.mainPage.manifestPath,
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
                                        manifestPath:
                                            pageEntry!.mainPage.manifestPath,
                                        params,
                                        searchParams,
                                        loaderData: result.loaderData,
                                        extraArgs: [
                                            jsonForScript(result.deferredKeys),
                                        ],
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
                                    const {
                                        rendered,
                                        documentMeta,
                                        documentAssets,
                                    } = (await render({
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
                                    manifestPath:
                                        pageEntry!.mainPage.manifestPath,
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
                            push(
                                `<template id="__page_html__">${html}</template>`,
                            );
                            push(
                                buildLoadingSwapScript(
                                    meta,
                                    assetsHtml,
                                    cspNonce,
                                ),
                            );
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
                                (html ?? '') +
                                    manifestHtml +
                                    clientHydrationScript,
                            );
                        push(transformHtml);
                        controller.close();
                        return;
                    } catch (error) {
                        streamError = streamError ?? error;
                        throw error;
                    } finally {
                        const statusCode = getResponseStatus(event) || 200;
                        const respCtx = createResponseContext(
                            reqCtx,
                            statusCode,
                        );
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

        return await renderPage();
    } catch (e: any) {
        if (e instanceof RedirectError || e.name === 'RedirectError') {
            return new Response('', {
                status: 302,
                headers: { Location: e.message },
            });
        }
        console.error(e);
        if (import.meta.env.DEV) {
            return new Response(
                renderDevOverlayDocument(e, {
                    method: req.method,
                    url: req.url,
                }),
                {
                    status: 500,
                    headers: { 'Content-Type': 'text/html' },
                },
            );
        }
        return new Response('Internal Server Error', { status: 500 });
    }
});

export default handler;
