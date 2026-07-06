import { describe, it, expect, vi, beforeEach } from 'vitest';

// handleServerFunction resolves the target chunk and parses the request's
// arguments (query-string JSON for GET/bound-args, formData/JSON body for
// POST) BEFORE the try block that runs the action and maps its errors. An
// unknown functionId or malformed input therefore threw unhandled, skipping
// the onRequestError/onResponseEnd instrumentation hooks entirely. These
// tests pin the fixed behavior: unknown chunk -> 404, malformed input -> 400,
// both still firing the instrumentation hooks. This file is intentionally
// excluded from the coverage gate today (see vitest.config.ts) but exercises
// the module directly through its public entry point.

const chunks: Record<string, { import: () => Promise<any> }> = {};
const safeExecuteHook = vi.fn(async () => undefined);
const invalidateCache = vi.fn();

vi.mock('vinxi/http', () => ({
    eventHandler: (fn: any) => fn,
    setHeader: vi.fn(),
    setResponseStatus: vi.fn(),
    appendResponseHeader: vi.fn(),
    toWebRequest: (event: any) => event.req,
    getWebRequest: (event: any) => event.req,
    getRequestIP: () => '127.0.0.1',
    getResponseStatus: () => 200,
    getResponseStatusText: () => '',
    getResponseHeader: () => undefined,
    getResponseHeaders: () => ({}),
    removeResponseHeader: vi.fn(),
    setResponseHeader: vi.fn(),
}));
vi.mock('vinxi/lib/invariant', () => ({ default: () => undefined }));
vi.mock('vinxi/manifest', () => ({
    getManifest: () => ({ chunks }),
}));
vi.mock('../utils/cache', () => ({
    invalidateCache: (...a: unknown[]) => invalidateCache(...a),
}));
vi.mock('../utils/instrumentation', () => ({
    createRequestContext: () => ({}),
    createResponseContext: () => ({}),
    getInstrumentation: () => null,
    safeExecuteHook: (...a: unknown[]) => safeExecuteHook(...a),
}));

import { handleServerFunction } from '../utils/server-action.server';

const makeEvent = (req: Request, extra?: Record<string, unknown>) => ({
    req,
    method: req.method,
    node: { req: {} },
    ...extra,
});

beforeEach(() => {
    for (const key of Object.keys(chunks)) delete chunks[key];
    safeExecuteHook.mockClear();
    invalidateCache.mockClear();
});

const hookNames = () => safeExecuteHook.mock.calls.map((c) => c[0]);

describe('handleServerFunction input guards', () => {
    it('returns 404 for an unknown functionId instead of throwing', async () => {
        // no 'missing-chunk' entry registered in `chunks`
        const req = new Request(
            'https://example.com/_server?id=missing-chunk&name=fn',
        );
        const res = (await handleServerFunction(
            makeEvent(req) as any,
        )) as Response;
        expect(res).toBeInstanceOf(Response);
        expect(res.status).toBe(404);
        expect(hookNames()).toContain('onRequestError');
        expect(hookNames()).toContain('onResponseEnd');
    });

    it('returns 400 for a malformed args query parameter instead of throwing', async () => {
        chunks.chunk1 = { import: async () => ({ fn: vi.fn() }) };
        const req = new Request(
            'https://example.com/_server?id=chunk1&name=fn&args=not-json',
        );
        const res = (await handleServerFunction(
            makeEvent(req) as any,
        )) as Response;
        expect(res).toBeInstanceOf(Response);
        expect(res.status).toBe(400);
        expect(hookNames()).toContain('onRequestError');
        expect(hookNames()).toContain('onResponseEnd');
    });

    it('returns 400 for a malformed POST JSON body instead of throwing', async () => {
        chunks.chunk1 = { import: async () => ({ fn: vi.fn() }) };
        const req = new Request(
            'https://example.com/_server?id=chunk1&name=fn',
            {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: 'not-json{',
            },
        );
        const res = (await handleServerFunction(
            makeEvent(req, { 'X-Server-Instance': undefined }) as any,
        )) as Response;
        expect(res).toBeInstanceOf(Response);
        expect(res.status).toBe(400);
        expect(hookNames()).toContain('onRequestError');
        expect(hookNames()).toContain('onResponseEnd');
    });
});
