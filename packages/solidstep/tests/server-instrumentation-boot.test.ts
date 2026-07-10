import { describe, it, expect, vi } from 'vitest';

// server.ts fires `instrumentationReady = onStart()` once at module-import
// time. onStart's route-manifest/config setup is wrapped in try/catch, but
// `await loadInstrumentation()` inside it is not -- a broken user
// `instrumentation.ts` rejects instrumentationReady with no `.catch()`
// attached, and the request handler awaits it (line 227) *outside* its own
// try/catch (line 235), so the rejection bypasses solidstep's normal
// RedirectError/dev-overlay/500 handling instead of producing a Response.
// This file mocks loadInstrumentation to reject, mirroring server.test.ts's
// mock scaffold, to prove requests still resolve to a Response afterwards.

const handleServerFunction = vi.fn();
const renderPage = vi.fn();
const matchRoute = vi.fn();
const getCachedModule = vi.fn();
const registerShutdownHandler = vi.hoisted(() => vi.fn());
const safeExecuteHook = vi.hoisted(() => vi.fn(async () => undefined));
const getInstrumentation = vi.hoisted(() => vi.fn(() => null as any));
const serveHoleData = vi.hoisted(() => vi.fn(async () => null as unknown));
const serveRouteData = vi.hoisted(() => vi.fn(async () => null as unknown));
const getMetadataManifest = vi.hoisted(() => vi.fn(() => undefined as any));
const setHeader = vi.hoisted(() => vi.fn());
const setResponseStatus = vi.hoisted(() => vi.fn());
const collectPrerenderTargets = vi.hoisted(() =>
    vi.fn(async () => [] as unknown[]),
);
const handleRevalidate = vi.hoisted(() =>
    vi.fn(async () => ({ status: 200, body: '{}' })),
);

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
// The bug: loadInstrumentation rejects, unlike server.test.ts's `async () => null`.
vi.mock('../utils/instrumentation', () => ({
    loadInstrumentation: async () => {
        throw new Error('broken instrumentation.ts');
    },
    getInstrumentation: (...a: unknown[]) => getInstrumentation(...a),
    safeExecuteHook: (...a: unknown[]) => safeExecuteHook(...a),
    createRequestContext: () => ({}),
    createResponseContext: (_reqCtx: unknown, statusCode: number) => ({
        statusCode,
    }),
    registerShutdownHandler: (...a: unknown[]) => registerShutdownHandler(...a),
}));
vi.mock('../server/route-manifest', () => ({
    createRouteManifest: async () => ({ rootNode: {}, metadataMap: new Map() }),
    collectPrerenderTargets: (...a: unknown[]) => collectPrerenderTargets(...a),
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
vi.mock('../server/revalidate', () => ({
    handleRevalidate: (...a: unknown[]) => handleRevalidate(...a),
}));
vi.mock('../server/isr', () => ({
    seedIsrFromManifest: async () => undefined,
}));
vi.mock('../server/render-page', () => ({
    renderPage: (...a: unknown[]) => renderPage(...a),
}));

import handler from '../server';

const makeEvent = (url: string) => ({ req: new Request(url) });

describe('server startup — instrumentation bootstrap failure', () => {
    it('does not let a rejected instrumentationReady bypass normal request handling', async () => {
        matchRoute.mockReturnValue(undefined);
        renderPage.mockResolvedValue(new Response('ok'));

        const res = (await handler(
            makeEvent('https://example.com/'),
        )) as Response;

        // Reaches renderPage's mock and returns its Response normally --
        // instrumentation failure degrades to a logged boot-time error rather
        // than failing every subsequent request.
        expect(res).toBeInstanceOf(Response);
        expect(await res.text()).toBe('ok');
    });
});
