import { describe, it, expect, vi, beforeEach } from 'vitest';

// server.ts is the thin top-level request router. It delegates to
// handleServerFunction / handleApiRoute / renderPage and wraps everything in a
// try/catch that maps RedirectError -> 302 and any other error -> 500. These
// tests pin that mapping actually applies to the delegated async work (a
// `return somePromise` inside a try block does NOT let its rejection reach the
// surrounding catch unless it is awaited — a real, easy-to-miss JS gotcha).
// server.ts is excluded from the coverage gate (covered by e2e); these are
// behavioral regression checks for the un-awaited-dispatch bug class.

const handleServerFunction = vi.fn();
const renderPage = vi.fn();
const matchRoute = vi.fn();
const getCachedModule = vi.fn();
const registerShutdownHandler = vi.hoisted(() => vi.fn());
const safeExecuteHook = vi.hoisted(() => vi.fn(async () => undefined));
const serveHoleData = vi.hoisted(() => vi.fn(async () => null as unknown));
const serveRouteData = vi.hoisted(() => vi.fn(async () => null as unknown));
const getMetadataManifest = vi.hoisted(() => vi.fn(() => undefined as any));
const setHeader = vi.hoisted(() => vi.fn());
const setResponseStatus = vi.hoisted(() => vi.fn());

vi.mock('vinxi/http', () => ({
    eventHandler: (fn: any) => fn,
    toWebRequest: (event: any) => event.req,
    getResponseStatus: () => 200,
    setHeader: (...a: unknown[]) => setHeader(...a),
    setResponseStatus: (...a: unknown[]) => setResponseStatus(...a),
}));
vi.mock('../utils/cache', () => ({ setCacheStore: vi.fn() }));
vi.mock('../utils/cache-store', () => ({
    MemoryCacheStore: class {},
    FilesystemCacheStore: class {},
}));
vi.mock('../utils/server-action.server', () => ({
    handleServerFunction: (...a: unknown[]) => handleServerFunction(...a),
}));
vi.mock('../utils/dev-overlay', () => ({
    renderDevOverlayDocument: () => '<html></html>',
}));
vi.mock('node:fs/promises', () => ({
    readFile: vi.fn().mockRejectedValue(new Error('no .config.json in test')),
}));
vi.mock('../utils/path-router', () => ({
    matchRoute: (...a: unknown[]) => matchRoute(...a),
    parseSearchParams: () => ({}),
}));
vi.mock('../utils/instrumentation', () => ({
    loadInstrumentation: async () => null,
    getInstrumentation: () => null,
    safeExecuteHook: (...a: unknown[]) => safeExecuteHook(...a),
    createRequestContext: () => ({}),
    createResponseContext: () => ({}),
    registerShutdownHandler: (...a: unknown[]) => registerShutdownHandler(...a),
}));
vi.mock('../server/route-manifest', () => ({
    createRouteManifest: async () => ({ rootNode: {}, metadataMap: new Map() }),
    collectPrerenderTargets: async () => [],
    ensureRouteManifest: async () => ({}),
    setRouteManifest: vi.fn(),
    getMetadataManifest: (...a: unknown[]) => getMetadataManifest(...a),
    ensureClientManifest: () => ({}),
    getCachedModule: (...a: unknown[]) => getCachedModule(...a),
}));
vi.mock('../server/data-endpoints', () => ({
    serveHoleData: (...a: unknown[]) => serveHoleData(...a),
    serveRouteData: (...a: unknown[]) => serveRouteData(...a),
}));
vi.mock('../server/isr', () => ({
    seedIsrFromManifest: async () => undefined,
}));
vi.mock('../server/render-page', () => ({
    renderPage: (...a: unknown[]) => renderPage(...a),
}));

import handler from '../server';
import { RedirectError } from '../utils/redirect';

const makeEvent = (url: string) => ({ req: new Request(url) });

beforeEach(() => {
    handleServerFunction.mockReset();
    renderPage.mockReset();
    matchRoute.mockReset();
    getCachedModule.mockReset();
    safeExecuteHook.mockClear();
    serveHoleData.mockReset().mockResolvedValue(null);
    serveRouteData.mockReset().mockResolvedValue(null);
    getMetadataManifest.mockReset().mockReturnValue(undefined);
    setHeader.mockClear();
    setResponseStatus.mockClear();
});

const hookNames = () => safeExecuteHook.mock.calls.map((c) => c[0]);

describe('server startup', () => {
    it('wires the shutdown handler during onStart', () => {
        expect(registerShutdownHandler).toHaveBeenCalled();
    });
});

describe('server request handler', () => {
    it('maps a rejected server-function dispatch to the 500 response', async () => {
        handleServerFunction.mockRejectedValue(new Error('boom'));
        const res = (await handler(
            makeEvent('https://example.com/_server?id=x&name=y'),
        )) as Response;
        expect(res).toBeInstanceOf(Response);
        expect(res.status).toBe(500);
    });

    it('maps a RedirectError from a rejected server-function dispatch to a 302', async () => {
        handleServerFunction.mockRejectedValue(new RedirectError('/login'));
        const res = (await handler(
            makeEvent('https://example.com/_server?id=x&name=y'),
        )) as Response;
        expect(res.status).toBe(302);
        expect(res.headers.get('Location')).toBe('/login');
    });

    it('does not dispatch a page path that merely contains "_server" to the server-function handler', async () => {
        matchRoute.mockReturnValue(undefined);
        renderPage.mockResolvedValue(new Response('ok'));
        await handler(makeEvent('https://example.com/page_server'));
        expect(handleServerFunction).not.toHaveBeenCalled();
        expect(renderPage).toHaveBeenCalled();
    });

    it('dispatches the trailing-slash /_server/ form to the server-function handler', async () => {
        handleServerFunction.mockResolvedValue(new Response('ok'));
        await handler(makeEvent('https://example.com/_server/?id=x&name=y'));
        expect(handleServerFunction).toHaveBeenCalled();
    });

    it('fires onResponseStart before returning an API route result', async () => {
        matchRoute.mockReturnValue({
            handler: { type: 'route', handler: {}, routePath: '/api/thing' },
            params: {},
        });
        getCachedModule.mockResolvedValue({ GET: async () => 'ok' });
        await handler(makeEvent('https://example.com/api/thing'));
        expect(hookNames()).toContain('onResponseStart');
    });

    it('maps a rejected API route handler to the 500 response', async () => {
        matchRoute.mockReturnValue({
            handler: { type: 'route', handler: {}, routePath: '/api/thing' },
            params: {},
        });
        getCachedModule.mockRejectedValue(new Error('route module boom'));
        const res = (await handler(
            makeEvent('https://example.com/api/thing'),
        )) as Response;
        expect(res.status).toBe(500);
    });

    it('maps a rejected renderPage call to the 500 response', async () => {
        matchRoute.mockReturnValue(undefined);
        renderPage.mockRejectedValue(new Error('render boom'));
        const res = (await handler(
            makeEvent('https://example.com/some-page'),
        )) as Response;
        expect(res.status).toBe(500);
    });

    it('answers the devtools well-known probe with a 204', async () => {
        const res = await handler(
            makeEvent(
                'https://example.com/.well-known/appspecific/com.chrome.devtools.json',
            ),
        );
        expect(setResponseStatus).toHaveBeenCalledWith(204);
        expect(res).toBeUndefined();
    });
});

describe('soft-nav data endpoints', () => {
    it('serves the PPR hole envelope from the loader endpoint', async () => {
        serveHoleData.mockResolvedValue('HOLE_ENVELOPE');
        const res = await handler(
            makeEvent('https://example.com/__solidstep_loader?manifest=/p'),
        );
        expect(res).toBe('HOLE_ENVELOPE');
        expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    });

    it('400s the loader endpoint when serveHoleData reports an invalid request', async () => {
        serveHoleData.mockResolvedValue(null);
        const res = await handler(
            makeEvent('https://example.com/__solidstep_loader'),
        );
        expect(setResponseStatus).toHaveBeenCalledWith(400);
        expect(res).toBe('Bad Request');
    });

    it('serves the soft-navigation route envelope from the route endpoint', async () => {
        serveRouteData.mockResolvedValue('ROUTE_ENVELOPE');
        const res = await handler(
            makeEvent('https://example.com/__solidstep_route?url=/about'),
        );
        expect(res).toBe('ROUTE_ENVELOPE');
    });

    it('400s the route endpoint when serveRouteData reports an invalid request', async () => {
        serveRouteData.mockResolvedValue(null);
        const res = await handler(
            makeEvent('https://example.com/__solidstep_route'),
        );
        expect(setResponseStatus).toHaveBeenCalledWith(400);
        expect(res).toBe('Bad Request');
    });
});

describe('dynamic metadata files', () => {
    it('serves a metadata convention file at its conventional URL with its Content-Type', async () => {
        getMetadataManifest.mockReturnValue(
            new Map([
                [
                    '/robots.txt',
                    {
                        contentType: 'text/plain; charset=utf-8',
                        handler: { src: 'app/robots.ts' },
                    },
                ],
            ]),
        );
        getCachedModule.mockResolvedValue({
            default: () => 'User-agent: *',
        });

        const res = await handler(makeEvent('https://example.com/robots.txt'));

        expect(res).toBe('User-agent: *');
        expect(setHeader).toHaveBeenCalledWith(
            'Content-Type',
            'text/plain; charset=utf-8',
        );
    });

    it("passes a metadata handler's Response straight through", async () => {
        const metaResponse = new Response('xml', { status: 200 });
        getMetadataManifest.mockReturnValue(
            new Map([
                [
                    '/sitemap.xml',
                    { contentType: 'application/xml', handler: { src: 'x' } },
                ],
            ]),
        );
        getCachedModule.mockResolvedValue({ default: () => metaResponse });

        const res = await handler(makeEvent('https://example.com/sitemap.xml'));

        expect(res).toBe(metaResponse);
    });
});
