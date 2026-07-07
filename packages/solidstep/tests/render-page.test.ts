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

vi.mock('vinxi/http', () => ({
    getResponseStatus: () => 200,
    setHeader: vi.fn(),
    setResponseStatus: vi.fn(),
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
    getInstrumentation: () => null,
    safeExecuteHook: async () => undefined,
    createRequestContext: () => ({ metadata: {} }),
    createResponseContext: () => ({}),
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
});

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
