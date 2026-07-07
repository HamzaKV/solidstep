import { describe, it, expect, vi, beforeEach } from 'vitest';

// renderPage orchestrates ISR/PPR/deferred/loading/main/error rendering and
// response assembly. This file starts with a single regression: when a page's
// own error.tsx *also* throws while rendering the fallback for an earlier
// render failure, the secondary failure (e2) was silently discarded — only
// the original error (e1) propagated, with no trace of why the error page
// itself never rendered. server/render-page.ts is excluded from the
// coverage gate today (covered by e2e); more behaviors land here in Phase 2.

const render = vi.fn();
const logger = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn() }));
const safeExecuteHook = vi.hoisted(() => vi.fn(async () => undefined));
const getInstrumentation = vi.hoisted(() => vi.fn(() => null as any));

const mockResponseStatus = vi.hoisted(() => ({ current: 200 }));
vi.mock('vinxi/http', () => ({
    getResponseStatus: () => mockResponseStatus.current,
    setHeader: vi.fn(),
    setResponseStatus: (status: number) => {
        mockResponseStatus.current = status;
    },
}));
vi.mock('solid-js/web', () => ({
    renderToStream: () => ({ pipe: vi.fn() }),
}));
vi.mock('../utils/escape', () => ({ escapeScript: (s: string) => s }));
vi.mock('../utils/logger', () => ({ logger }));
vi.mock('../utils/dev-overlay', () => ({
    renderDevOverlayDocument: () => '',
    devOverlayClientScript: () => '',
}));
vi.mock('../utils/html', () => ({
    renderAssetsToHtml: () => '',
    jsonForScript: () => '',
    buildHydrationScript: () => '',
    buildHeadHtml: () => '',
    createBaseMeta: () => ({}),
}));
vi.mock('../utils/loading-swap', () => ({
    buildLoadingSwapScript: () => '',
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
    getCachedModule: async () => ({}),
}));
vi.mock('../server/isr', () => ({
    serveIsr: async () => ({ html: '', cacheStatus: 'hit' }),
}));
vi.mock('../server/types', () => ({
    isDeferredResult: () => false,
    isPprResult: () => false,
}));
vi.mock('../server/render', () => ({
    render: (...a: unknown[]) => render(...a),
    routeNeedsStreaming: async () => false,
    template: '<!--app-head--><!--app-body-->',
}));

import { renderPage } from '../server/render-page';

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
    getInstrumentation.mockReturnValue(null);
    mockResponseStatus.current = 200;
});

const onResponseStartCalls = () =>
    safeExecuteHook.mock.calls.filter((c) => c[0] === 'onResponseStart');

const baseCtx = () => ({
    event: {} as any,
    req: new Request('https://example.com/p'),
    matched: { type: 'page' } as any,
    pageEntry: {
        mainPage: { manifestPath: '/p', options: undefined },
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
});
