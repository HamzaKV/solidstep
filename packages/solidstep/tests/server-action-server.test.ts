import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { toJSONAsync } from 'seroval';
import { SEROVAL_PLUGINS } from '../utils/serialize';

// handleServerFunction resolves the target chunk and parses the request's
// arguments (query-string JSON for GET/bound-args, formData/JSON body for
// POST) BEFORE the try block that runs the action and maps its errors. An
// unknown functionId or malformed input therefore threw unhandled, skipping
// the onRequestError/onResponseEnd instrumentation hooks entirely. These
// tests pin the fixed behavior: unknown chunk -> 404, malformed input -> 400,
// both still firing the instrumentation hooks, plus the success/no-JS/error
// response-shaping branches. `provideRequestEvent` (solid-js/web/storage) is
// mocked to run its callback directly — the real implementation needs a full
// solid-js SSR build context this unit-test environment doesn't set up; that
// context (async-local request state) isn't what these tests are about.

const chunks: Record<string, { import: () => Promise<any> }> = {};
const safeExecuteHook = vi.fn(async () => undefined);
const invalidateCache = vi.fn();
const responseHeaders = new Map<string, string>();
const setResponseStatus = vi.fn();
const setHeader = vi.fn();

vi.mock('vinxi/http', () => ({
    eventHandler: (fn: any) => fn,
    setHeader: (...a: unknown[]) => setHeader(...a),
    setResponseStatus: (...a: unknown[]) => setResponseStatus(...a),
    appendResponseHeader: vi.fn(),
    toWebRequest: (event: any) => event.req,
    getWebRequest: (event: any) => event.req,
    getRequestIP: () => '127.0.0.1',
    getResponseStatus: () => 200,
    getResponseStatusText: () => '',
    getResponseHeader: (_event: unknown, name: string) =>
        responseHeaders.get(name),
    getResponseHeaders: () => ({}),
    removeResponseHeader: vi.fn(),
    setResponseHeader: (_event: unknown, name: string, value: string) => {
        responseHeaders.set(name, value);
    },
}));
vi.mock('vinxi/lib/invariant', () => ({ default: () => undefined }));
vi.mock('vinxi/manifest', () => ({
    getManifest: () => ({ chunks }),
}));
vi.mock('../utils/cache', () => ({
    invalidateCache: (...a: unknown[]) => invalidateCache(...a),
}));
const createRequestContext = vi.fn(() => ({}));
vi.mock('../utils/instrumentation', () => ({
    createRequestContext: (...a: unknown[]) => createRequestContext(...a),
    createResponseContext: () => ({}),
    getInstrumentation: () => null,
    safeExecuteHook: (...a: unknown[]) => safeExecuteHook(...a),
}));
vi.mock('solid-js', () => ({ sharedConfig: {} }));
vi.mock('solid-js/web/storage', () => ({
    provideRequestEvent: async (_ctx: unknown, fn: () => unknown) => fn(),
}));

import { handleServerFunction } from '../utils/server-action.server';
import { isTrustedServerActionOrigin } from '../utils/server-action-origin';
import { createResponseStub } from '../utils/server-action.server';

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
    setResponseStatus.mockClear();
    setHeader.mockClear();
    responseHeaders.clear();
    createRequestContext.mockClear();
});

const hookNames = () => safeExecuteHook.mock.calls.map((c) => c[0]);

describe('handleServerFunction onResponseStart', () => {
    it('fires before the 404 dispatch-error response', async () => {
        const req = new Request(
            'https://example.com/_server?id=missing-chunk&name=fn',
        );
        await handleServerFunction(makeEvent(req) as any);
        expect(hookNames()).toContain('onResponseStart');
    });
});

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

    it.each([
        '__proto__',
        'constructor',
        'toString',
        'hasOwnProperty',
    ])('returns the normal 404 (not a leaked 500) for functionId=%s', async (functionId) => {
        const req = new Request(
            `https://example.com/_server?id=${functionId}&name=fn`,
        );
        const res = (await handleServerFunction(
            makeEvent(req) as any,
        )) as Response;
        expect(res).toBeInstanceOf(Response);
        expect(res.status).toBe(404);
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

describe('handleServerFunction success path (JS client)', () => {
    const jsReq = (id: string, name: string) =>
        new Request(`https://example.com/_server?id=${id}&name=${name}`, {
            headers: { 'X-Server-Instance': 'inst-1' },
        });

    it('serializes the action result to a stream and fires onResponseEnd (no error)', async () => {
        chunks.chunk1 = { import: async () => ({ fn: async () => 'ok' }) };

        const res = await handleServerFunction(
            makeEvent(jsReq('chunk1', 'fn')) as any,
        );

        expect(res).toBeInstanceOf(ReadableStream);
        expect(hookNames()).toContain('onResponseEnd');
        expect(hookNames()).not.toContain('onRequestError');
    });

    it('invalidates the cache when the action marks a path via X-Revalidate', async () => {
        const { setResponseHeader } = await import('vinxi/http');
        chunks.chunk1 = {
            import: async () => ({
                fn: async (event: any) => {
                    setResponseHeader(event, 'X-Revalidate', '/dashboard');
                    return 'ok';
                },
            }),
        };

        await handleServerFunction(makeEvent(jsReq('chunk1', 'fn')) as any);

        expect(invalidateCache).toHaveBeenCalledWith('/dashboard');
    });

    it('invalidates every path when the action revalidates more than one', async () => {
        chunks.chunk1 = {
            import: async () => ({
                fn: async () => {
                    // Simulate two revalidatePath() calls: an appended header
                    // reads back as an array from getResponseHeader.
                    responseHeaders.set('X-Revalidate', [
                        '/a',
                        '/b',
                    ] as unknown as string);
                    return 'ok';
                },
            }),
        };

        await handleServerFunction(makeEvent(jsReq('chunk1', 'fn')) as any);

        expect(invalidateCache).toHaveBeenCalledWith('/a');
        expect(invalidateCache).toHaveBeenCalledWith('/b');
    });

    it('passes a Response marked X-Content-Raw straight through unmodified', async () => {
        const rawResponse = new Response('raw body', {
            headers: { 'X-Content-Raw': '1' },
        });
        chunks.chunk1 = {
            import: async () => ({ fn: async () => rawResponse }),
        };

        const res = await handleServerFunction(
            makeEvent(jsReq('chunk1', 'fn')) as any,
        );

        expect(res).toBe(rawResponse);
    });

    it('serializes a thrown error to a stream, sets X-Error and a 500 status', async () => {
        chunks.chunk1 = {
            import: async () => ({
                fn: async () => {
                    throw new Error('action failed');
                },
            }),
        };

        const res = await handleServerFunction(
            makeEvent(jsReq('chunk1', 'fn')) as any,
        );

        expect(res).toBeInstanceOf(ReadableStream);
        expect(setResponseStatus).toHaveBeenCalledWith(expect.anything(), 500);
        expect(hookNames()).toContain('onRequestError');
    });

    it('does not force a 500 status when the thrown error is a RedirectError', async () => {
        const { RedirectError } = await import('../utils/redirect');
        chunks.chunk1 = {
            import: async () => ({
                fn: async () => {
                    throw new RedirectError('/login');
                },
            }),
        };

        await handleServerFunction(makeEvent(jsReq('chunk1', 'fn')) as any);

        expect(setResponseStatus).not.toHaveBeenCalledWith(
            expect.anything(),
            500,
        );
    });
});

describe('handleServerFunction no-JS form fallback', () => {
    it('runs the action and redirects back to the referring page with a 303', async () => {
        chunks.chunk1 = { import: async () => ({ fn: async () => 'ok' }) };
        const req = new Request(
            'https://example.com/_server?id=chunk1&name=fn',
            { headers: { Referer: 'https://example.com/form-page' } },
        );

        const res = await handleServerFunction(makeEvent(req) as any);

        expect(res).toBe('');
        expect(setResponseStatus).toHaveBeenCalledWith(expect.anything(), 303);
    });

    it('falls back to "/" for a cross-origin Referer instead of redirecting off-site', async () => {
        chunks.chunk1 = { import: async () => ({ fn: async () => 'ok' }) };
        const req = new Request(
            'https://example.com/_server?id=chunk1&name=fn',
            { headers: { Referer: 'https://evil.example.com/phish' } },
        );

        const res = await handleServerFunction(makeEvent(req) as any);

        expect(res).toBe('');
        expect(setResponseStatus).toHaveBeenCalledWith(expect.anything(), 303);
        expect(setHeader).toHaveBeenCalledWith(
            expect.anything(),
            'Location',
            '/',
        );
    });

    it('falls back to "/" for a malformed Referer', async () => {
        chunks.chunk1 = { import: async () => ({ fn: async () => 'ok' }) };
        const req = new Request(
            'https://example.com/_server?id=chunk1&name=fn',
            { headers: { Referer: 'not a url' } },
        );

        const res = await handleServerFunction(makeEvent(req) as any);

        expect(res).toBe('');
        expect(setHeader).toHaveBeenCalledWith(
            expect.anything(),
            'Location',
            '/',
        );
    });

    it('returns an action-returned Response directly instead of discarding it behind the 303', async () => {
        const download = new Response('csv,data', {
            status: 200,
            headers: { 'Content-Type': 'text/csv' },
        });
        chunks.chunk1 = { import: async () => ({ fn: async () => download }) };
        const req = new Request(
            'https://example.com/_server?id=chunk1&name=fn',
            { headers: { Referer: 'https://example.com/form-page' } },
        );

        const res = await handleServerFunction(makeEvent(req) as any);

        expect(res).toBe(download);
        expect(setResponseStatus).not.toHaveBeenCalledWith(
            expect.anything(),
            303,
        );
    });

    it('honors redirect() thrown by the action with a 303 to its target', async () => {
        const { RedirectError } = await import('../utils/redirect');
        chunks.chunk1 = {
            import: async () => ({
                fn: async () => {
                    throw new RedirectError('/login');
                },
            }),
        };
        const req = new Request(
            'https://example.com/_server?id=chunk1&name=fn',
            { headers: { Referer: 'https://example.com/form-page' } },
        );

        await handleServerFunction(makeEvent(req) as any);

        expect(setResponseStatus).toHaveBeenCalledWith(expect.anything(), 303);
        expect(setHeader).toHaveBeenCalledWith(
            expect.anything(),
            'Location',
            '/login',
        );
    });

    it('forwards a raw Response thrown by a no-JS action (not RedirectError, not a generic error)', async () => {
        const thrown = new Response('custom failure body', { status: 422 });
        chunks.chunk1 = {
            import: async () => ({
                fn: async () => {
                    throw thrown;
                },
            }),
        };
        const req = new Request(
            'https://example.com/_server?id=chunk1&name=fn',
        );

        const res = await handleServerFunction(makeEvent(req) as any);

        expect(res).toBe(thrown);
    });

    it('maps a throwing action to a 500 Response instead of leaking the raw error object', async () => {
        const boom = new Error('no-js failure');
        chunks.chunk1 = {
            import: async () => ({
                fn: async () => {
                    throw boom;
                },
            }),
        };
        const req = new Request(
            'https://example.com/_server?id=chunk1&name=fn',
        );

        const res = (await handleServerFunction(
            makeEvent(req) as any,
        )) as Response;

        expect(res).toBeInstanceOf(Response);
        expect(res.status).toBe(500);
    });
});

describe('handleServerFunction dispatch id resolution', () => {
    it('resolves functionId/name from the X-Server-Id header (bound-args form)', async () => {
        chunks.chunk1 = { import: async () => ({ fn: async () => 'ok' }) };
        const req = new Request('https://example.com/_server', {
            headers: {
                'X-Server-Id': 'chunk1#fn',
                'X-Server-Instance': 'inst-1',
            },
        });

        const res = await handleServerFunction(makeEvent(req) as any);

        expect(res).toBeInstanceOf(ReadableStream);
    });
});

describe('handleServerFunction body parsing', () => {
    it('decodes a valid seroval-encoded JSON POST body into the action args', async () => {
        const envelope = await toJSONAsync(['hello', 42], {
            plugins: SEROVAL_PLUGINS,
        });
        let received: unknown;
        chunks.chunk1 = {
            import: async () => ({
                fn: async (...args: unknown[]) => {
                    received = args;
                    return 'ok';
                },
            }),
        };
        const req = new Request(
            'https://example.com/_server?id=chunk1&name=fn',
            {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'X-Server-Instance': 'inst-1',
                },
                body: JSON.stringify(envelope),
            },
        );

        await handleServerFunction(makeEvent(req) as any);

        expect(received).toEqual(['hello', 42]);
    });

    it('parses a multipart/form-data POST body into a single FormData arg', async () => {
        const form = new FormData();
        form.set('name', 'ada');
        let received: unknown;
        chunks.chunk1 = {
            import: async () => ({
                fn: async (data: FormData) => {
                    received = data;
                    return 'ok';
                },
            }),
        };
        const req = new Request(
            'https://example.com/_server?id=chunk1&name=fn',
            {
                method: 'POST',
                headers: { 'X-Server-Instance': 'inst-1' },
                body: form,
            },
        );

        await handleServerFunction(makeEvent(req) as any);

        expect(received).toBeInstanceOf(FormData);
        expect((received as FormData).get('name')).toBe('ada');
    });
});

describe('handleServerFunction Response-result forwarding', () => {
    it('forwards a non-redirect status from a returned Response and unwraps its customBody', async () => {
        const result = new Response(null, { status: 201 });
        (result as any).customBody = async () => 'created';
        chunks.chunk1 = { import: async () => ({ fn: async () => result }) };
        const req = new Request(
            'https://example.com/_server?id=chunk1&name=fn',
            { headers: { 'X-Server-Instance': 'inst-1' } },
        );

        const res = await handleServerFunction(makeEvent(req) as any);

        expect(res).toBeInstanceOf(ReadableStream);
        expect(setResponseStatus).toHaveBeenCalledWith(expect.anything(), 201);
    });

    it('forwards a >=400 status too (the other half of the non-redirect range check)', async () => {
        // The 201 case above satisfies `status < 300` alone; this exercises
        // the `status >= 400` side of the OR for a status that is neither.
        const result = new Response(null, { status: 500 });
        chunks.chunk1 = { import: async () => ({ fn: async () => result }) };
        const req = new Request(
            'https://example.com/_server?id=chunk1&name=fn',
            { headers: { 'X-Server-Instance': 'inst-1' } },
        );

        await handleServerFunction(makeEvent(req) as any);

        expect(setResponseStatus).toHaveBeenCalledWith(expect.anything(), 500);
    });

    it('does not forward a redirect-range status (300-399)', async () => {
        const result = new Response(null, { status: 302 });
        chunks.chunk1 = { import: async () => ({ fn: async () => result }) };
        const req = new Request(
            'https://example.com/_server?id=chunk1&name=fn',
            { headers: { 'X-Server-Instance': 'inst-1' } },
        );

        await handleServerFunction(makeEvent(req) as any);

        expect(setResponseStatus).not.toHaveBeenCalledWith(
            expect.anything(),
            302,
        );
    });

    it('serializes a thrown Response (customBody) as the error envelope', async () => {
        const thrown = new Response(null, { status: 403 });
        (thrown as any).customBody = async () => 'forbidden';
        chunks.chunk1 = {
            import: async () => ({
                fn: async () => {
                    throw thrown;
                },
            }),
        };
        const req = new Request(
            'https://example.com/_server?id=chunk1&name=fn',
            { headers: { 'X-Server-Instance': 'inst-1' } },
        );

        const res = await handleServerFunction(makeEvent(req) as any);

        expect(res).toBeInstanceOf(ReadableStream);
        expect(setResponseStatus).toHaveBeenCalledWith(expect.anything(), 403);
    });

    it('normalizes a bodyless, non-raw Response result to null before serializing', async () => {
        const result = new Response(null, { status: 200 });
        chunks.chunk1 = { import: async () => ({ fn: async () => result }) };
        const req = new Request(
            'https://example.com/_server?id=chunk1&name=fn',
            { headers: { 'X-Server-Instance': 'inst-1' } },
        );

        const res = await handleServerFunction(makeEvent(req) as any);

        expect(res).toBeInstanceOf(ReadableStream);
    });

    it('normalizes a bodyless, thrown Response to null before serializing', async () => {
        const thrown = new Response(null, { status: 403 });
        chunks.chunk1 = {
            import: async () => ({
                fn: async () => {
                    throw thrown;
                },
            }),
        };
        const req = new Request(
            'https://example.com/_server?id=chunk1&name=fn',
            { headers: { 'X-Server-Instance': 'inst-1' } },
        );

        const res = await handleServerFunction(makeEvent(req) as any);

        expect(res).toBeInstanceOf(ReadableStream);
    });
});

describe('handleServerFunction bound-args (GET) parsing', () => {
    it('decodes a plain JSON args array (no seroval envelope) from the query string', async () => {
        let received: unknown;
        chunks.chunk1 = {
            import: async () => ({
                fn: async (...args: unknown[]) => {
                    received = args;
                    return 'ok';
                },
            }),
        };
        const args = encodeURIComponent(JSON.stringify(['a', 1]));
        const req = new Request(
            `https://example.com/_server?id=chunk1&name=fn&args=${args}`,
            { headers: { 'X-Server-Instance': 'inst-1' } },
        );

        await handleServerFunction(makeEvent(req) as any);

        expect(received).toEqual(['a', 1]);
    });

    it('returns 400 for a malformed multipart/form-data POST body', async () => {
        chunks.chunk1 = { import: async () => ({ fn: vi.fn() }) };
        const req = new Request(
            'https://example.com/_server?id=chunk1&name=fn',
            {
                method: 'POST',
                headers: { 'content-type': 'multipart/form-data; boundary=x' },
                body: 'not a real multipart body',
            },
        );

        const res = (await handleServerFunction(
            makeEvent(req) as any,
        )) as Response;

        expect(res.status).toBe(400);
    });

    it('returns 404 when neither X-Server-Id nor id/name query params are present', async () => {
        const req = new Request('https://example.com/_server');

        const res = (await handleServerFunction(
            makeEvent(req) as any,
        )) as Response;

        expect(res.status).toBe(404);
    });
});

describe('handleServerFunction NODE_ENV=development messages', () => {
    const withDevEnv = async (fn: () => Promise<void>) => {
        const prev = process.env.NODE_ENV;
        process.env.NODE_ENV = 'development';
        try {
            await fn();
        } finally {
            process.env.NODE_ENV = prev;
        }
    };

    it('includes the real message in the missing-id 404 response', async () => {
        await withDevEnv(async () => {
            const req = new Request('https://example.com/_server');
            const res = (await handleServerFunction(
                makeEvent(req) as any,
            )) as Response;
            expect(await res.text()).toBe('Server function not found');
        });
    });

    it('includes the real message in the unknown-chunk 404 response', async () => {
        await withDevEnv(async () => {
            const req = new Request(
                'https://example.com/_server?id=missing&name=fn',
            );
            const res = (await handleServerFunction(
                makeEvent(req) as any,
            )) as Response;
            expect(await res.text()).toContain('Unknown server function chunk');
        });
    });

    it('includes the real message in the malformed-args 400 response', async () => {
        await withDevEnv(async () => {
            chunks.chunk1 = { import: async () => ({ fn: vi.fn() }) };
            const req = new Request(
                'https://example.com/_server?id=chunk1&name=fn&args=not-json',
            );
            const res = (await handleServerFunction(
                makeEvent(req) as any,
            )) as Response;
            expect(await res.text()).toBe('Malformed args query parameter');
        });
    });

    it('includes the real message in the cross-origin-blocked 403 response', async () => {
        await withDevEnv(async () => {
            const req = new Request(
                'https://example.com/_server?id=chunk1&name=fn',
                { headers: { origin: 'https://evil.example.com' } },
            );
            const res = (await handleServerFunction(
                makeEvent(req) as any,
            )) as Response;
            expect(res.status).toBe(403);
            expect(await res.text()).toBe(
                'Cross-origin server function request blocked',
            );
        });
    });
});

describe('handleServerFunction seroval-encoded bound args (GET)', () => {
    it('decodes a full seroval envelope (not a plain JSON array) from the query string', async () => {
        const envelope = await toJSONAsync(['x', 1], {
            plugins: SEROVAL_PLUGINS,
        });
        let received: unknown;
        chunks.chunk1 = {
            import: async () => ({
                fn: async (...args: unknown[]) => {
                    received = args;
                    return 'ok';
                },
            }),
        };
        const args = encodeURIComponent(JSON.stringify(envelope));
        const req = new Request(
            `https://example.com/_server?id=chunk1&name=fn&args=${args}`,
            { headers: { 'X-Server-Instance': 'inst-1' } },
        );

        await handleServerFunction(makeEvent(req) as any);

        expect(received).toEqual(['x', 1]);
    });
});

describe('handleServerFunction non-Error thrown values (JS client)', () => {
    it('uses the string itself as the X-Error message when a string is thrown', async () => {
        chunks.chunk1 = {
            import: async () => ({
                fn: async () => {
                    throw 'plain string failure';
                },
            }),
        };
        const req = new Request(
            'https://example.com/_server?id=chunk1&name=fn',
            { headers: { 'X-Server-Instance': 'inst-1' } },
        );

        const res = await handleServerFunction(makeEvent(req) as any);

        expect(res).toBeInstanceOf(ReadableStream);
        expect(setResponseStatus).toHaveBeenCalledWith(expect.anything(), 500);
    });

    it('falls back to a generic X-Error message when a non-Error, non-string value is thrown', async () => {
        chunks.chunk1 = {
            import: async () => ({
                fn: async () => {
                    throw { code: 'WEIRD' };
                },
            }),
        };
        const req = new Request(
            'https://example.com/_server?id=chunk1&name=fn',
            { headers: { 'X-Server-Instance': 'inst-1' } },
        );

        const res = await handleServerFunction(makeEvent(req) as any);

        expect(res).toBeInstanceOf(ReadableStream);
        expect(setResponseStatus).toHaveBeenCalledWith(expect.anything(), 500);
    });
});

describe('handleServerFunction origin check', () => {
    afterEach(() => {
        delete (globalThis as any).__SOLIDSTEP_CONFIG__;
    });

    it('blocks a cross-origin POST with a 403 by default', async () => {
        chunks.chunk1 = { import: async () => ({ fn: async () => 'ok' }) };
        const req = new Request(
            'https://example.com/_server?id=chunk1&name=fn',
            {
                method: 'POST',
                headers: {
                    'X-Server-Instance': 'inst-1',
                    Origin: 'https://evil.test',
                },
            },
        );

        const res = (await handleServerFunction(
            makeEvent(req) as any,
        )) as Response;

        expect(res).toBeInstanceOf(Response);
        expect(res.status).toBe(403);
    });

    it('passes a same-origin POST (matching Origin header)', async () => {
        chunks.chunk1 = { import: async () => ({ fn: async () => 'ok' }) };
        const req = new Request(
            'https://example.com/_server?id=chunk1&name=fn',
            {
                method: 'POST',
                headers: {
                    'X-Server-Instance': 'inst-1',
                    Origin: 'https://example.com',
                },
            },
        );

        const res = await handleServerFunction(makeEvent(req) as any);

        expect(res).toBeInstanceOf(ReadableStream);
    });

    it('passes a cross-origin Origin header when Sec-Fetch-Site is same-origin', async () => {
        chunks.chunk1 = { import: async () => ({ fn: async () => 'ok' }) };
        const req = new Request(
            'https://example.com/_server?id=chunk1&name=fn',
            {
                method: 'POST',
                headers: {
                    'X-Server-Instance': 'inst-1',
                    Origin: 'https://evil.test',
                    'Sec-Fetch-Site': 'same-origin',
                },
            },
        );

        const res = await handleServerFunction(makeEvent(req) as any);

        expect(res).toBeInstanceOf(ReadableStream);
    });

    it('passes when Sec-Fetch-Site is none (user-initiated, e.g. typed URL/bookmark)', async () => {
        chunks.chunk1 = { import: async () => ({ fn: async () => 'ok' }) };
        const req = new Request(
            'https://example.com/_server?id=chunk1&name=fn',
            {
                method: 'POST',
                headers: {
                    'X-Server-Instance': 'inst-1',
                    'Sec-Fetch-Site': 'none',
                },
            },
        );

        const res = await handleServerFunction(makeEvent(req) as any);

        expect(res).toBeInstanceOf(ReadableStream);
    });

    it('passes a request with neither Origin nor Sec-Fetch-Site (non-browser client)', async () => {
        chunks.chunk1 = { import: async () => ({ fn: async () => 'ok' }) };
        const req = new Request(
            'https://example.com/_server?id=chunk1&name=fn',
            { method: 'POST', headers: { 'X-Server-Instance': 'inst-1' } },
        );

        const res = await handleServerFunction(makeEvent(req) as any);

        expect(res).toBeInstanceOf(ReadableStream);
    });

    it('passes a cross-origin Origin listed in the trustedOrigins allowlist', async () => {
        (globalThis as any).__SOLIDSTEP_CONFIG__ = {
            security: {
                serverActions: { trustedOrigins: ['trusted.test'] },
            },
        };
        chunks.chunk1 = { import: async () => ({ fn: async () => 'ok' }) };
        const req = new Request(
            'https://example.com/_server?id=chunk1&name=fn',
            {
                method: 'POST',
                headers: {
                    'X-Server-Instance': 'inst-1',
                    Origin: 'https://trusted.test',
                },
            },
        );

        const res = await handleServerFunction(makeEvent(req) as any);

        expect(res).toBeInstanceOf(ReadableStream);
    });

    it('fails closed (403) for a cross-site Sec-Fetch-Site with no Origin header', async () => {
        chunks.chunk1 = { import: async () => ({ fn: async () => 'ok' }) };
        const req = new Request(
            'https://example.com/_server?id=chunk1&name=fn',
            {
                method: 'POST',
                headers: {
                    'X-Server-Instance': 'inst-1',
                    'Sec-Fetch-Site': 'cross-site',
                },
            },
        );

        const res = (await handleServerFunction(
            makeEvent(req) as any,
        )) as Response;

        expect(res).toBeInstanceOf(Response);
        expect(res.status).toBe(403);
    });

    it('fails closed (403) when the Origin header is malformed', async () => {
        chunks.chunk1 = { import: async () => ({ fn: async () => 'ok' }) };
        const req = new Request(
            'https://example.com/_server?id=chunk1&name=fn',
            {
                method: 'POST',
                headers: {
                    'X-Server-Instance': 'inst-1',
                    Origin: 'not a url',
                },
            },
        );

        const res = (await handleServerFunction(
            makeEvent(req) as any,
        )) as Response;

        expect(res).toBeInstanceOf(Response);
        expect(res.status).toBe(403);
    });

    it('skips the check entirely when originCheck is set to false', async () => {
        (globalThis as any).__SOLIDSTEP_CONFIG__ = {
            security: { serverActions: { originCheck: false } },
        };
        chunks.chunk1 = { import: async () => ({ fn: async () => 'ok' }) };
        const req = new Request(
            'https://example.com/_server?id=chunk1&name=fn',
            {
                method: 'POST',
                headers: {
                    'X-Server-Instance': 'inst-1',
                    Origin: 'https://evil.test',
                },
            },
        );

        const res = await handleServerFunction(makeEvent(req) as any);

        expect(res).toBeInstanceOf(ReadableStream);
    });
});

describe('isTrustedServerActionOrigin allowlist semantics', () => {
    const url = new URL('https://example.com/_server');
    const reqWith = (origin: string) =>
        new Request('https://example.com/_server', {
            method: 'POST',
            headers: { Origin: origin },
        });

    it('accepts a bare-host allowlist entry', () => {
        expect(
            isTrustedServerActionOrigin(reqWith('https://trusted.test'), url, [
                'trusted.test',
            ]),
        ).toBe(true);
    });

    it('accepts a full-origin allowlist entry (matching cors.ts semantics)', () => {
        expect(
            isTrustedServerActionOrigin(reqWith('https://trusted.test'), url, [
                'https://trusted.test',
            ]),
        ).toBe(true);
    });

    it('matches allowlist entries case-insensitively', () => {
        expect(
            isTrustedServerActionOrigin(reqWith('https://trusted.test'), url, [
                'TRUSTED.TEST',
            ]),
        ).toBe(true);
    });

    it('rejects an origin not in the allowlist', () => {
        expect(
            isTrustedServerActionOrigin(reqWith('https://evil.test'), url, [
                'https://trusted.test',
            ]),
        ).toBe(false);
    });
});

describe('createResponseStub headers', () => {
    it('getSetCookie() returns [] when no cookie was set', () => {
        const resp = createResponseStub({} as any);
        // The Headers.getSetCookie() contract is string[] with no holes —
        // never [undefined].
        expect(resp.headers.getSetCookie()).toEqual([]);
    });

    it('has() reflects whether a header is actually set', () => {
        const resp = createResponseStub({} as any);
        expect(resp.headers.has('X-Never-Set')).toBe(false);
        resp.headers.set('X-Now-Set', '1');
        expect(resp.headers.has('X-Now-Set')).toBe(true);
    });
});

describe('handleServerFunction request context', () => {
    it('threads pathname/searchParams into createRequestContext instead of letting it re-parse the URL', async () => {
        chunks.chunk1 = { import: async () => ({ fn: async () => 'ok' }) };
        const req = new Request(
            'https://example.com/_server?id=chunk1&name=fn&extra=1',
            { headers: { 'X-Server-Instance': 'inst-1' } },
        );

        await handleServerFunction(makeEvent(req) as any);

        expect(createRequestContext).toHaveBeenCalledWith(
            req,
            expect.objectContaining({
                pathname: '/_server',
                searchParams: expect.any(Object),
            }),
        );
    });
});
