import {
    eventHandler,
    getResponseStatus,
    toWebRequest,
    setHeader,
    setResponseStatus,
} from 'vinxi/http';
import { RedirectError } from './utils/redirect.js';
import { setCacheStore } from './utils/cache.js';
import { MemoryCacheStore, FilesystemCacheStore } from './utils/cache-store.js';
import { handleServerFunction } from './utils/server-action.server.js';
import { renderDevOverlayDocument } from './utils/dev-overlay.js';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    matchRoute,
    parseSearchParams,
    type RouteHandler,
    type RoutePageHandler,
    type SearchParams,
} from './utils/path-router.js';
import {
    loadInstrumentation,
    getInstrumentation,
    safeExecuteHook,
    createRequestContext,
    createResponseContext,
    registerShutdownHandler,
} from './utils/instrumentation.js';
import {
    createRouteManifest,
    collectPrerenderTargets,
    ensureRouteManifest,
    setRouteManifest,
    getMetadataManifest,
    ensureClientManifest,
    getCachedModule,
} from './server/route-manifest.js';
import { serveHoleData, serveRouteData } from './server/data-endpoints.js';
import { handleRevalidate } from './server/revalidate.js';
import { seedIsrFromManifest } from './server/isr.js';
import type { RouteApiModule, RouteMethodHandler } from './server/types.js';
import { renderPage } from './server/render-page.js';
import {
    ISR_BYPASS_HEADER,
    PRERENDER_ENDPOINT,
    LOADER_ENDPOINT,
    ROUTE_ENDPOINT,
    SERVER_FN_BASE,
    REVALIDATE_ENDPOINT,
} from './server/constants.js';

/**
 * The API-route variant of a matched {@link RouteHandler} (`route.ts`). The
 * manifest also attaches a `routePath` (used for instrumentation), which the
 * shared `RouteHandler` type does not declare, so it is added here.
 */
type ApiRouteHandler = Extract<RouteHandler, { type: 'route' }> & {
    routePath?: string;
};

let instrumentationReady: Promise<void> | null = null;

// `.config.json` and `prerender-manifest.json` are written at build into the
// Nitro server output dir (`nitro.options.output.serverDir`, see index.ts).
// `dirname(process.argv[1])` finds it correctly for `node
// .output/server/index.mjs` (Node/Docker presets), but serverless presets
// (Netlify et al.) load the bundled handler inside an existing platform
// runtime process, where `argv[1]` is the *platform's own* entry (e.g. AWS
// Lambda's Node runtime lives at /var/runtime) rather than the deployed
// function code — which is `process.cwd()` there (Lambda's documented
// /var/task working dir). Try both and use whichever one actually has the
// file; `exists` is injectable so this stays unit-testable without mocking
// `node:fs`.
export const resolveServerDir = (
    argv1: string | undefined,
    cwd: string,
    exists: (path: string) => boolean = existsSync,
): string => {
    const argv1Dir = argv1 ? dirname(argv1) : undefined;
    const found = [argv1Dir, cwd].find(
        (d): d is string => !!d && exists(`${d}/.config.json`),
    );
    if (found) return found;
    if (argv1Dir) return argv1Dir;
    // The built server's `import.meta.url` is not always a usable absolute
    // file URL (notably on Windows in the Nitro bundle), hence the try/catch.
    try {
        return dirname(fileURLToPath(import.meta.url));
    } catch {
        return cwd;
    }
};

const onStart = async () => {
    const serverDir = resolveServerDir(process.argv[1], process.cwd());
    /* v8 ignore start -- onStart runs once at module-import time, fixed to a
       single mocked path for the whole test file; its config-load/cache-
       selection branches are exercised on every real request in the
       kitchen-sink e2e suite (which boots this exact code with a real
       .config.json). Covering every branch here in isolation would need
       vi.resetModules() + a fresh dynamic import per variant, disproportionate
       to this one-time startup routine. */
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
            // @ts-expect-error
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
    /* v8 ignore stop */

    // Load instrumentation
    const instrumentation = await loadInstrumentation();
    // loadInstrumentation is mocked to always return null for this onStart
    // singleton run; the register-hook call itself is exercised by
    // tests/instrumentation-shutdown.test.ts and e2e.
    /* v8 ignore start */
    if (instrumentation?.register) {
        await safeExecuteHook('register', instrumentation.register);
    }
    /* v8 ignore stop */
    registerShutdownHandler(instrumentation);

    // Seed ISR artifacts (written by the build-time crawler) into the active
    // cache store so the first request is warm. Done after register() so a
    // user-provided store is the one being seeded.
    await seedIsrFromManifest(serverDir);
};

instrumentationReady = onStart().catch((e) => {
    console.error('Error initializing instrumentation:', e);
});

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
    pathname: string,
) => {
    const inst = getInstrumentation();
    const reqCtx = createRequestContext(req, {
        routePath: matched.routePath || 'unknown',
        routeType: 'api',
        params,
        searchParams,
        pathname,
    });
    await safeExecuteHook('onRequest', inst?.onRequest, req, reqCtx);

    try {
        const routeModule = await getCachedModule<RouteApiModule>(
            matched.handler,
        );
        const reqMethod = req.method?.toUpperCase();
        // A Fetch API Request's method is never empty (defaults to 'GET'),
        // so the falsy-reqMethod branch below is defensive and unreachable.
        /* v8 ignore else */
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
                if (inst?.onResponseStart || inst?.onResponseEnd) {
                    // A method handler usually *returns* a Response (with its
                    // own status) rather than calling setResponseStatus, so
                    // prefer the returned Response's status.
                    const respCtx = createResponseContext(
                        reqCtx,
                        result instanceof Response
                            ? result.status
                            : getResponseStatus(event) || 200,
                    );
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
                return result;
            }

            throw new Error(
                `Method ${reqMethod} not implemented in ${matched.handler.src}`,
            );
        }
        /* v8 ignore next */
        throw new Error(`Unsupported request method: ${reqMethod}`);
    } catch (error) {
        await safeExecuteHook(
            'onRequestError',
            inst?.onRequestError,
            error instanceof Error ? error : new Error(String(error)),
            req,
            reqCtx,
        );
        throw error;
    }
};

const handler = eventHandler(async (event) => {
    const req = toWebRequest(event);
    // Parsed once and threaded through the rest of the dispatcher instead of
    // re-parsing `req.url` at every branch below.
    const urlObj = new URL(req.url);
    const pathnamePart = urlObj.pathname;

    try {
        if (instrumentationReady) await instrumentationReady;

        if (
            pathnamePart === '/.well-known/appspecific/com.chrome.devtools.json'
        ) {
            setResponseStatus(204);
            return;
        }

        if (
            pathnamePart === SERVER_FN_BASE ||
            pathnamePart.startsWith(`${SERVER_FN_BASE}/`)
        ) {
            return await handleServerFunction(event);
        }

        // Build-time prerender discovery. Only answered when the process was
        // started in prerender mode (the build crawler sets this env var), so it
        // is never reachable in a normal production server.
        if (
            process.env.SOLIDSTEP_PRERENDER === '1' &&
            pathnamePart === PRERENDER_ENDPOINT
        ) {
            setHeader('Content-Type', 'application/json');
            return JSON.stringify(await collectPrerenderTargets());
        }

        // On-demand cache revalidation: only reachable when configured (an
        // unset token means the `if` never fires — falls through to a normal
        // 404), matching PRERENDER_ENDPOINT's convention above.
        if (
            process.env.SOLIDSTEP_REVALIDATE_TOKEN &&
            pathnamePart === REVALIDATE_ENDPOINT
        ) {
            const { status, body } = await handleRevalidate(req);
            setResponseStatus(status);
            setHeader(
                'Content-Type',
                status === 200
                    ? 'application/json'
                    : 'text/plain; charset=utf-8',
            );
            return body;
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
        if (pathnamePart === LOADER_ENDPOINT) {
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
        if (pathnamePart === ROUTE_ENDPOINT) {
            const body = await serveRouteData(req, cspNonce, locals);
            if (body === null) {
                setResponseStatus(400);
                return 'Bad Request';
            }
            setHeader('Content-Type', 'text/plain; charset=utf-8');
            setHeader('Cache-Control', 'no-store');
            return body;
        }

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
            return await handleApiRoute(
                event,
                req,
                matched,
                params,
                searchParams,
                pathnamePart,
            );
        }

        // API routes returned above, so any remaining match is necessarily a
        // page handler. Narrowing once here lets the render branches below use a
        // typed `pageEntry!` instead of repeating `pageEntry!`.
        const pageEntry: RoutePageHandler | undefined =
            matched?.type === 'page' ? matched : undefined;

        // Delegate the page/not-found render — ISR short-circuit, PPR shell,
        // deferred streaming, loading boundary, main render, error boundary, and
        // response assembly — to the render-page module, keeping this handler a
        // thin request router.
        return await renderPage({
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
        });
    } catch (e: any) {
        if (e instanceof RedirectError || e.name === 'RedirectError') {
            return new Response('', {
                // `?? 302` covers a duck-typed RedirectError (name match
                // without the class) that carries no status.
                status: (e as RedirectError).status ?? 302,
                headers: { Location: e.message },
            });
        }
        console.error(e);
        // import.meta.env.DEV is statically true under vitest's default mode
        // ('test' !== 'production'), so the prod-only fallback below is
        // unreachable here; it's exercised by the kitchen-sink e2e suite's
        // production build.
        /* v8 ignore else */
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
