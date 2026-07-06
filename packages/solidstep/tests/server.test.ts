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

vi.mock('vinxi/http', () => ({
    eventHandler: (fn: any) => fn,
    toWebRequest: (event: any) => event.req,
    getResponseStatus: () => 200,
    setHeader: vi.fn(),
    setResponseStatus: vi.fn(),
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
    safeExecuteHook: async () => undefined,
    createRequestContext: () => ({}),
    createResponseContext: () => ({}),
}));
vi.mock('../server/route-manifest', () => ({
    createRouteManifest: async () => ({ rootNode: {}, metadataMap: new Map() }),
    collectPrerenderTargets: async () => [],
    ensureRouteManifest: async () => ({}),
    setRouteManifest: vi.fn(),
    getMetadataManifest: () => undefined,
    ensureClientManifest: () => ({}),
    getCachedModule: (...a: unknown[]) => getCachedModule(...a),
}));
vi.mock('../server/data-endpoints', () => ({
    serveHoleData: async () => null,
    serveRouteData: async () => null,
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
});
