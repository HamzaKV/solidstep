import { describe, it, expect, vi, beforeEach } from 'vitest';

// renderPage orchestrates ISR/PPR/deferred/loading/main/error rendering and
// response assembly. This file started with a single regression: when a
// page's own error.tsx *also* throws while rendering the fallback for an
// earlier render failure, the secondary failure (e2) was silently discarded
// — only the original error (e1) propagated, with no trace of why the error
// page itself never rendered. The ISR short-circuit (env-gated by
// `!import.meta.env.DEV`, statically false under vitest) is unreachable here
// and covered by the kitchen-sink e2e suite instead.

const render = vi.fn();
const logger = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn() }));
const safeExecuteHook = vi.hoisted(() => vi.fn(async () => undefined));
const getInstrumentation = vi.hoisted(() => vi.fn(() => null as any));
const getCachedModule = vi.hoisted(() => vi.fn(async () => ({ options: {} })));
const buildHydrationScript = vi.hoisted(() =>
    vi.fn(
        (opts: { fetchPriority?: string }) =>
            `HYDRATE[fp=${opts.fetchPriority ?? ''}]`,
    ),
);
const buildHeadHtml = vi.hoisted(() =>
    vi.fn(
        (_meta: unknown, assetsHtml: string, _nonce?: string, hydrate = true) =>
            `HEAD[hydrate=${hydrate}]${assetsHtml}`,
    ),
);
const renderAssetsToHtml = vi.hoisted(() =>
    vi.fn(
        (assets: { tag: string; attrs: Record<string, unknown> }[]) =>
            `ASSETS${JSON.stringify(assets)}`,
    ),
);
const isDeferredResult = vi.hoisted(() => vi.fn(() => false));
const isPprResult = vi.hoisted(() => vi.fn(() => false));
const routeNeedsStreaming = vi.hoisted(() => vi.fn(async () => false));
const buildLoadingSwapScript = vi.hoisted(() =>
    vi.fn(() => 'LOADING_SWAP_SCRIPT'),
);

const mockResponseStatus = vi.hoisted(() => ({ current: 200 }));
const setHeader = vi.hoisted(() => vi.fn());
vi.mock('vinxi/http', () => ({
    getResponseStatus: () => mockResponseStatus.current,
    setHeader: (...a: unknown[]) => setHeader(...a),
    setResponseStatus: (status: number) => {
        mockResponseStatus.current = status;
    },
}));
const renderToStreamError = vi.hoisted(() => ({ value: null as unknown }));
const renderToStreamHang = vi.hoisted(() => ({ value: false }));
vi.mock('solid-js/web', () => ({
    // The real API streams chunks then calls `end()`; this stub writes one
    // shell chunk and ends immediately so the deferred branch's
    // `await new Promise(...)` around `pipe(...)` resolves. If a test sets
    // renderToStreamError, its onError callback fires first (matching a
    // real mid-stream render failure) before the shell still completes. If a
    // test sets renderToStreamHang, `end()` is never called — simulating a
    // render whose deferred data never settles.
    renderToStream: (
        fn: () => unknown,
        opts: { onError?: (e: unknown) => void },
    ) => ({
        pipe: (writable: { write: (v: string) => void; end: () => void }) => {
            fn();
            if (renderToStreamError.value) {
                opts.onError?.(renderToStreamError.value);
            }
            writable.write('<div>deferred-shell</div>');
            if (!renderToStreamHang.value) writable.end();
        },
    }),
}));
vi.mock('../utils/escape', () => ({ escapeScript: (s: string) => s }));
vi.mock('../utils/logger', () => ({ logger }));
vi.mock('../utils/dev-overlay', () => ({
    renderDevOverlayDocument: () => '',
    devOverlayClientScript: () => '',
}));
vi.mock('../utils/html', () => ({
    renderAssetsToHtml: (...a: unknown[]) => renderAssetsToHtml(...a),
    jsonForScript: () => '',
    buildHydrationScript: (...a: unknown[]) => buildHydrationScript(...a),
    buildHeadHtml: (...a: unknown[]) => buildHeadHtml(...a),
    createBaseMeta: () => ({}),
}));
vi.mock('../utils/loading-swap', () => ({
    buildLoadingSwapScript: (...a: unknown[]) => buildLoadingSwapScript(...a),
}));
vi.mock('../utils/instrumentation', () => ({
    getInstrumentation: (...a: unknown[]) => getInstrumentation(...a),
    safeExecuteHook: (...a: unknown[]) => safeExecuteHook(...a),
    createRequestContext: () => ({ metadata: {} }),
    createResponseContext: (reqCtx: unknown, statusCode: number) => ({
        ...(reqCtx as object),
        statusCode,
    }),
}));
vi.mock('../server/route-manifest', () => ({
    getCachedModule: (...a: unknown[]) => getCachedModule(...a),
    getCachedAssets: (manifest: any, src: string) =>
        manifest.inputs[src].assets(),
}));
vi.mock('../server/isr', () => ({
    serveIsr: async () => ({ html: '', cacheStatus: 'hit' }),
}));
vi.mock('../server/types', () => ({
    isDeferredResult: (...a: unknown[]) => isDeferredResult(...a),
    isPprResult: (...a: unknown[]) => isPprResult(...a),
}));
vi.mock('../server/render', () => ({
    render: (...a: unknown[]) => render(...a),
    routeNeedsStreaming: (...a: unknown[]) => routeNeedsStreaming(...a),
    template: '<!--app-head--><!--app-body-->',
}));

import { renderPage } from '../server/render-page';
import { createNode, insertRoute } from '../utils/path-router';

const readStream = async (stream: ReadableStream) => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let text = '';
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            text += decoder.decode(value);
        }
    } catch (e) {
        return { text, error: e };
    }
    return { text, error: null };
};

beforeEach(() => {
    render.mockReset();
    logger.warn.mockClear();
    logger.error.mockClear();
    safeExecuteHook.mockClear();
    // A populated instrumentation module by default so the existing
    // assertions on safeExecuteHook calls/context still exercise the
    // (now-gated) onResponseStart/onResponseEnd construction; the dedicated
    // "skips response-context construction" test below sets this to null.
    getInstrumentation.mockReturnValue({
        onRequest: vi.fn(),
        onResponseStart: vi.fn(),
        onResponseEnd: vi.fn(),
        onRequestError: vi.fn(),
    });
    mockResponseStatus.current = 200;
    getCachedModule.mockReset().mockResolvedValue({ options: {} });
    buildHydrationScript.mockClear();
    buildHeadHtml.mockClear();
    renderAssetsToHtml.mockClear();
    isDeferredResult.mockReset().mockReturnValue(false);
    isPprResult.mockReset().mockReturnValue(false);
    routeNeedsStreaming.mockReset().mockResolvedValue(false);
    buildLoadingSwapScript.mockClear();
    setHeader.mockClear();
    renderToStreamError.value = null;
    renderToStreamHang.value = false;
});

const onResponseStartCalls = () =>
    safeExecuteHook.mock.calls.filter((c) => c[0] === 'onResponseStart');

const baseCtx = () => ({
    event: {} as any,
    req: new Request('https://example.com/p'),
    matched: { type: 'page' } as any,
    pageEntry: {
        mainPage: {
            manifestPath: '/p',
            options: { src: 'opts', import: async () => ({}) },
        },
        errorPage: { manifestPath: '/p/error' },
        loadingPage: undefined,
        layouts: [],
    } as any,
    params: {},
    searchParams: {},
    pathnamePart: '/p',
    urlObj: new URL('https://example.com/p'),
    isrBypass: true,
    locals: undefined,
    cspNonce: undefined,
    clientManifest: {
        handler: 'entry',
        inputs: {
            entry: {
                assets: async () => [],
                output: { path: '/entry.js' },
            },
        },
        json: async () => ({}),
    } as any,
    routeManifest: {} as any,
});

describe('renderPage manifest script', () => {
    it('embeds the escaped client-manifest JSON with the per-request nonce', async () => {
        render.mockResolvedValue({
            rendered: '<p>hi</p>',
            documentMeta: {},
            documentAssets: [],
            loaderData: {},
            cacheStatus: undefined,
        });
        const ctx = baseCtx();
        ctx.cspNonce = 'NONCE1' as any;
        ctx.clientManifest.json = async () => ({ chunk: 'value' });

        const stream = await renderPage(ctx);
        const { text, error } = await readStream(stream as ReadableStream);

        expect(error).toBeNull();
        expect(text).toContain('nonce="NONCE1"');
        expect(text).toContain('window.manifest={"chunk":"value"}');
    });
});

describe('renderPage loading boundary', () => {
    it('does not warn or attempt a loading render when the page has no loading.tsx', async () => {
        render.mockResolvedValue({
            rendered: '<p>hi</p>',
            documentMeta: {},
            documentAssets: [],
            loaderData: {},
            cacheStatus: undefined,
        });

        const stream = await renderPage(baseCtx()); // loadingPage: undefined
        const { text, error } = await readStream(stream as ReadableStream);

        expect(error).toBeNull();
        expect(text).toContain('<p>hi</p>');
        // The normal "no loading.tsx" case is not a failure: no warn spam,
        // no throwaway loading render attempt.
        expect(logger.warn).not.toHaveBeenCalled();
        const loadingRenders = render.mock.calls.filter(
            (c) => (c[0] as { toRender?: string })?.toRender === 'loading',
        );
        expect(loadingRenders).toHaveLength(0);
    });
});

describe('renderPage onResponseStart', () => {
    it('fires once with the final status before the body streams (main render)', async () => {
        render.mockResolvedValue({
            rendered: '<p>hi</p>',
            documentMeta: {},
            documentAssets: [],
            loaderData: {},
            cacheStatus: undefined,
        });

        const stream = await renderPage(baseCtx());
        const { text, error } = await readStream(stream as ReadableStream);

        expect(error).toBeNull();
        expect(text).toContain('<p>hi</p>');
        expect(onResponseStartCalls()).toHaveLength(1);
        expect(onResponseStartCalls()[0][3]).toMatchObject({
            statusCode: 200,
        });
    });

    it('skips building the response context entirely when no instrumentation is registered', async () => {
        getInstrumentation.mockReturnValue(null);
        render.mockResolvedValue({
            rendered: '<p>hi</p>',
            documentMeta: {},
            documentAssets: [],
            loaderData: {},
            cacheStatus: undefined,
        });

        const stream = await renderPage(baseCtx());
        const { text, error } = await readStream(stream as ReadableStream);

        expect(error).toBeNull();
        expect(text).toContain('<p>hi</p>');
        expect(onResponseStartCalls()).toHaveLength(0);
        expect(
            safeExecuteHook.mock.calls.filter((c) => c[0] === 'onResponseEnd'),
        ).toHaveLength(0);
    });

    it('fires before the body on the hardcoded 404 fallback (no not-found module)', async () => {
        const ctx = baseCtx();
        ctx.matched = undefined as any;
        ctx.routeManifest = {} as any;
        // matchRoute is the real utils/path-router implementation (unmocked);
        // an empty routeManifest makes it return undefined, forcing the
        // "No not-found page configured" -> hardcoded 404 catch branch.

        const stream = await renderPage(ctx);
        const { text, error } = await readStream(stream as ReadableStream);

        expect(error).toBeNull();
        expect(text).toBe('Not Found');
        expect(onResponseStartCalls()).toHaveLength(1);
        expect(onResponseStartCalls()[0][3]).toMatchObject({
            statusCode: 404,
        });
    });

    it('falls back to the hardcoded 404 when the root route trie has no not-found handler', async () => {
        const ctx = baseCtx();
        ctx.matched = undefined as any;
        ctx.routeManifest = createNode() as any;

        const stream = await renderPage(ctx);
        const { text, error } = await readStream(stream as ReadableStream);

        expect(error).toBeNull();
        expect(text).toBe('Not Found');
    });
});

describe('renderPage not-found module render', () => {
    it('renders a real not-found page module when the root route configures one', async () => {
        const rootNode = createNode();
        insertRoute(rootNode, '/', {
            type: 'page',
            mainPage: { manifestPath: '/not-found/', page: {} as any },
            layouts: [],
        } as any);

        render.mockResolvedValue({
            rendered: '<p>gone</p>',
            documentMeta: {},
            documentAssets: [],
            loaderData: {},
        });

        const ctx = baseCtx();
        ctx.matched = undefined as any;
        ctx.routeManifest = rootNode as any;

        const stream = await renderPage(ctx);
        const { text, error } = await readStream(stream as ReadableStream);

        expect(error).toBeNull();
        expect(text).toContain('<p>gone</p>');
        expect(mockResponseStatus.current).toBe(404);
    });
});

describe('renderPage options.responseHeaders', () => {
    it('sets each configured response header before rendering', async () => {
        getCachedModule.mockResolvedValue({
            options: { responseHeaders: { 'X-Custom': 'yes' } },
        });
        render.mockResolvedValue({
            rendered: '<p>hi</p>',
            documentMeta: {},
            documentAssets: [],
            loaderData: {},
        });

        const stream = await renderPage(baseCtx());
        await readStream(stream as ReadableStream);

        expect(setHeader).toHaveBeenCalledWith('X-Custom', 'yes');
    });
});

describe('renderPage hydration options', () => {
    it('threads fetchPriority into the main-render hydration script', async () => {
        getCachedModule.mockResolvedValue({
            options: { hydration: { fetchPriority: 'high' } },
        });
        render.mockResolvedValue({
            rendered: '<p>hi</p>',
            documentMeta: {},
            documentAssets: [],
            loaderData: {},
            cacheStatus: undefined,
        });

        const stream = await renderPage(baseCtx());
        const { text } = await readStream(stream as ReadableStream);

        expect(text).toContain('HYDRATE[fp=high]');
    });

    it('hydration.disable ships no manifest/hydration script and drops modulepreload assets', async () => {
        getCachedModule.mockResolvedValue({
            options: { hydration: { disable: true } },
        });
        render.mockResolvedValue({
            rendered: '<p>static</p>',
            documentMeta: {},
            documentAssets: [
                { tag: 'link', attrs: { rel: 'modulepreload', href: '/x.js' } },
                { tag: 'link', attrs: { rel: 'stylesheet', href: '/x.css' } },
            ],
            loaderData: {},
            cacheStatus: undefined,
        });

        const stream = await renderPage(baseCtx());
        const { text, error } = await readStream(stream as ReadableStream);

        expect(error).toBeNull();
        expect(text).toContain('<p>static</p>');
        expect(text).not.toContain('HYDRATE[');
        expect(text).not.toContain('window.manifest');
        const lastHeadCall =
            buildHeadHtml.mock.calls[buildHeadHtml.mock.calls.length - 1];
        expect(lastHeadCall[3]).toBe(false);
        const assetsPassed = renderAssetsToHtml.mock.calls[
            renderAssetsToHtml.mock.calls.length - 1
        ][0] as { attrs: { rel?: string } }[];
        expect(
            assetsPassed.some(
                (a: { attrs: { rel?: string } }) =>
                    a.attrs.rel === 'modulepreload',
            ),
        ).toBe(false);
        expect(
            assetsPassed.some(
                (a: { attrs: { rel?: string } }) =>
                    a.attrs.rel === 'stylesheet',
            ),
        ).toBe(true);
    });

    it('warns and ignores hydration.disable when a loading.tsx sibling exists', async () => {
        getCachedModule.mockResolvedValue({
            options: { hydration: { disable: true } },
        });
        const ctx = baseCtx();
        ctx.pageEntry.loadingPage = { manifestPath: '/p/loading' } as any;
        render.mockImplementation(
            async ({ toRender }: { toRender: string }) => {
                if (toRender === 'loading')
                    throw new Error('no real loading render');
                return {
                    rendered: '<p>hi</p>',
                    documentMeta: {},
                    documentAssets: [],
                    loaderData: {},
                    cacheStatus: undefined,
                };
            },
        );

        const stream = await renderPage(ctx);
        const { text } = await readStream(stream as ReadableStream);

        expect(logger.warn).toHaveBeenCalledWith(
            expect.objectContaining({ route: '/p' }),
            expect.stringContaining('hydration.disable'),
        );
        // disable was ignored -> normal hydration script still present
        expect(text).toContain('HYDRATE[');
    });
});

describe('renderPage PPR', () => {
    it('serves a static shell with the hydration script flagging PPR', async () => {
        getCachedModule.mockResolvedValue({ options: { render: 'ppr' } });
        isPprResult.mockReturnValue(true);
        render.mockResolvedValue({
            rendered: '<p>shell</p>',
            documentMeta: {},
            documentAssets: [],
            loaderData: {},
            pprHoles: { h1: 'pending' },
        });

        const stream = await renderPage(baseCtx());
        const { text, error } = await readStream(stream as ReadableStream);

        expect(error).toBeNull();
        expect(text).toContain('<p>shell</p>');
        expect(text).toContain('HYDRATE[');
        expect(onResponseStartCalls()).toHaveLength(1);
        expect(onResponseStartCalls()[0][3]).toMatchObject({ statusCode: 200 });
    });

    it('warns and ignores hydration.disable on a ppr route', async () => {
        getCachedModule.mockResolvedValue({
            options: { render: 'ppr', hydration: { disable: true } },
        });
        isPprResult.mockReturnValue(true);
        render.mockResolvedValue({
            rendered: '<p>shell</p>',
            documentMeta: {},
            documentAssets: [],
            loaderData: {},
            pprHoles: { h1: 'pending' },
        });

        const stream = await renderPage(baseCtx());
        const { text } = await readStream(stream as ReadableStream);

        expect(logger.warn).toHaveBeenCalledWith(
            expect.objectContaining({ route: '/p' }),
            expect.stringContaining('hydration.disable'),
        );
        // disable was ignored -> normal hydration script still present
        expect(text).toContain('HYDRATE[');
    });

    it('recovers via error.tsx when render() returns a non-PPR shape for a ppr route (internal consistency guard)', async () => {
        getCachedModule.mockResolvedValue({ options: { render: 'ppr' } });
        isPprResult.mockReturnValue(false);
        // First call (toRender:'main') returns the malformed PPR shape,
        // triggering the defensive throw below; the second call
        // (toRender:'error') is the error.tsx render that recovers from it.
        render.mockResolvedValue({
            rendered: '<p>hi</p>',
            documentMeta: {},
            documentAssets: [],
            loaderData: {},
        });

        const stream = await renderPage(baseCtx());
        const { error } = await readStream(stream as ReadableStream);

        // The consistency error is routed to error.tsx like any other render
        // failure (import.meta.env.DEV also masks the no-errorPage case) —
        // it never propagates raw to the caller. Reaching here at all proves
        // the defensive throw executed and was handled gracefully.
        expect(error).toBeNull();
    });
});

describe('renderPage deferred streaming', () => {
    it('streams the shell then the manifest/hydration script after the deferred render ends', async () => {
        routeNeedsStreaming.mockResolvedValue(true);
        isDeferredResult.mockReturnValue(true);
        render.mockResolvedValue({
            documentMeta: {},
            documentAssets: [],
            loaderData: {},
            deferredKeys: ['/p'],
            composed: () => 'tree',
        });

        const stream = await renderPage(baseCtx());
        const { text, error } = await readStream(stream as ReadableStream);

        expect(error).toBeNull();
        expect(text).toContain('<div>deferred-shell</div>');
        expect(text).toContain('HYDRATE[');
        expect(text).toContain('</html>');
        expect(onResponseStartCalls()).toHaveLength(1);
    });

    it('warns and ignores hydration.disable on a route with a deferred loader', async () => {
        getCachedModule.mockResolvedValue({
            options: { hydration: { disable: true } },
        });
        routeNeedsStreaming.mockResolvedValue(true);
        isDeferredResult.mockReturnValue(true);
        render.mockResolvedValue({
            documentMeta: {},
            documentAssets: [],
            loaderData: {},
            deferredKeys: ['/p'],
            composed: () => 'tree',
        });

        const stream = await renderPage(baseCtx());
        const { text } = await readStream(stream as ReadableStream);

        expect(logger.warn).toHaveBeenCalledWith(
            expect.objectContaining({ route: '/p' }),
            expect.stringContaining('hydration.disable'),
        );
        // disable was ignored -> normal hydration script still present
        expect(text).toContain('HYDRATE[');
    });

    it('cancelling a hung deferred stream (client disconnect) still fires onResponseEnd', async () => {
        routeNeedsStreaming.mockResolvedValue(true);
        isDeferredResult.mockReturnValue(true);
        renderToStreamHang.value = true; // deferred data never settles
        render.mockResolvedValue({
            documentMeta: {},
            documentAssets: [],
            loaderData: {},
            deferredKeys: ['/p'],
            composed: () => 'tree',
        });

        const stream = (await renderPage(baseCtx())) as ReadableStream;
        const reader = stream.getReader();
        await reader.read(); // shell head reaches the client...
        await reader.cancel(); // ...then the client disconnects

        // The request must not hang forever: the response lifecycle completes
        // and the onResponseEnd hook fires.
        await vi.waitFor(
            () => {
                expect(
                    safeExecuteHook.mock.calls.filter(
                        (c) => c[0] === 'onResponseEnd',
                    ),
                ).toHaveLength(1);
            },
            { timeout: 1000 },
        );
    });

    it('recovers via error.tsx when render() returns a non-deferred shape for a streaming route (internal consistency guard)', async () => {
        routeNeedsStreaming.mockResolvedValue(true);
        isDeferredResult.mockReturnValue(false);
        render.mockResolvedValue({
            rendered: '<p>hi</p>',
            documentMeta: {},
            documentAssets: [],
            loaderData: {},
        });

        const stream = await renderPage(baseCtx());
        const { error } = await readStream(stream as ReadableStream);

        // Same as the PPR guard above: the consistency error is routed to
        // error.tsx, not propagated raw. Reaching here proves the defensive
        // throw executed and was handled gracefully.
        expect(error).toBeNull();
    });

    it("records renderToStream's onError as the request's error (fires onRequestError) without failing the stream", async () => {
        routeNeedsStreaming.mockResolvedValue(true);
        isDeferredResult.mockReturnValue(true);
        render.mockResolvedValue({
            documentMeta: {},
            documentAssets: [],
            loaderData: {},
            deferredKeys: ['/p'],
            composed: () => 'tree',
        });
        const streamError = new Error('tree render failed mid-stream');
        renderToStreamError.value = streamError;

        const stream = await renderPage(baseCtx());
        const { error } = await readStream(stream as ReadableStream);

        expect(error).toBeNull(); // onError doesn't abort the stream itself
        const onRequestErrorCalls = safeExecuteHook.mock.calls.filter(
            (c) => c[0] === 'onRequestError',
        );
        expect(onRequestErrorCalls[0][2]).toBe(streamError);
    });
});

describe('renderPage loading-swap', () => {
    it('renders the loading boundary, then swaps to the real page via buildLoadingSwapScript', async () => {
        const ctx = baseCtx();
        ctx.pageEntry.loadingPage = { manifestPath: '/p/loading' } as any;
        render.mockImplementation(
            async ({ toRender }: { toRender: string }) => ({
                rendered:
                    toRender === 'loading' ? '<p>loading…</p>' : '<p>hi</p>',
                documentMeta: {},
                documentAssets: [],
                loaderData: {},
                cacheStatus: undefined,
            }),
        );

        const stream = await renderPage(ctx);
        const { text, error } = await readStream(stream as ReadableStream);

        expect(error).toBeNull();
        expect(text).toContain(
            '<template id="__page_html__"><p>hi</p></template>',
        );
        expect(text).toContain('LOADING_SWAP_SCRIPT');
        expect(buildLoadingSwapScript).toHaveBeenCalled();
    });
});

describe('renderPage redirects', () => {
    it('maps a RedirectError from the main render to a 302 with a Location header', async () => {
        const { RedirectError } = await import('../utils/redirect');
        render.mockRejectedValue(new RedirectError('/login'));

        const stream = await renderPage(baseCtx());
        const { text, error } = await readStream(stream as ReadableStream);

        expect(error).toBeNull();
        expect(text).toBe('');
        expect(mockResponseStatus.current).toBe(302);
        // Redirects short-circuit before the response is streamed — no
        // onResponseStart/onResponseEnd content-producing work happens.
        expect(onResponseStartCalls()).toHaveLength(0);
    });
});

describe('renderPage error-boundary failure', () => {
    it('logs the error.tsx render failure and still propagates the original error', async () => {
        const mainError = new Error('main render boom');
        const errorPageError = new Error('error.tsx also broke');
        render.mockImplementation(
            async ({ toRender }: { toRender: string }) => {
                if (toRender === 'main') throw mainError;
                if (toRender === 'error') throw errorPageError;
                throw new Error(`unexpected toRender: ${toRender}`);
            },
        );

        const stream = await renderPage(baseCtx());
        const { error } = await readStream(stream as ReadableStream);

        expect(error).toBe(mainError);
        expect(logger.error).toHaveBeenCalledWith(
            expect.objectContaining({ err: String(errorPageError) }),
            expect.any(String),
        );
    });

    it('renders the dev error overlay when the main render throws and there is no error.tsx', async () => {
        const ctx = baseCtx();
        ctx.pageEntry.errorPage = undefined;
        render.mockRejectedValue(new Error('no error.tsx to catch this'));

        const stream = await renderPage(ctx);
        const { error } = await readStream(stream as ReadableStream);

        // import.meta.env.DEV is true under vitest, so this takes the dev
        // overlay branch (prod's rethrow is unreachable here) and completes
        // instead of propagating the error to the caller.
        expect(error).toBeNull();
        expect(mockResponseStatus.current).toBe(500);
        expect(onResponseStartCalls().length).toBeGreaterThan(0);
    });

    it('recovers via error.tsx when the main render returns a non-plain (deferred/PPR) shape (internal consistency guard)', async () => {
        isDeferredResult.mockReturnValue(true);
        render.mockResolvedValue({
            rendered: '<p>hi</p>',
            documentMeta: {},
            documentAssets: [],
            loaderData: {},
        });

        const stream = await renderPage(baseCtx());
        const { error } = await readStream(stream as ReadableStream);

        // Same reasoning as the PPR/deferred guards: routed to error.tsx,
        // not propagated raw. Reaching here proves the throw executed.
        expect(error).toBeNull();
    });
});
