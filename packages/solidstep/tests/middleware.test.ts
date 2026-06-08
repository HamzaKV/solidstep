import { describe, it, expect, vi, beforeEach } from 'vitest';

// Vinxi's defineMiddleware just returns its options object; mirror that so the
// composed { onRequest, onBeforeResponse } is returned for inspection.
vi.mock('vinxi/http', () => ({
    defineMiddleware: (options: any) => options,
}));

import { defineMiddleware, type Middleware } from '../utils/middleware';

// Minimal fake H3 event: `handled` flips once respondWith is called.
const makeEvent = () => {
    let handled = false;
    return {
        get handled() {
            return handled;
        },
        respondWith: vi.fn(async (_response: Response) => {
            handled = true;
        }),
    } as any;
};

describe('defineMiddleware — onRequest', () => {
    it('handles an empty array without error', async () => {
        const composed = defineMiddleware([]);
        const event = makeEvent();
        await expect(composed.onRequest(event)).resolves.toBeUndefined();
        expect(event.respondWith).not.toHaveBeenCalled();
    });

    it('runs a single middleware', async () => {
        const spy = vi.fn();
        const composed = defineMiddleware([{ onRequest: spy }]);
        const event = makeEvent();
        await composed.onRequest(event);
        expect(spy).toHaveBeenCalledWith(event);
    });

    it('runs multiple middleware in array order', async () => {
        const calls: number[] = [];
        const mws: Middleware[] = [
            {
                onRequest: () => {
                    calls.push(1);
                },
            },
            {
                onRequest: () => {
                    calls.push(2);
                },
            },
            {
                onRequest: () => {
                    calls.push(3);
                },
            },
        ];
        await defineMiddleware(mws).onRequest(makeEvent());
        expect(calls).toEqual([1, 2, 3]);
    });

    it('skips units without an onRequest hook', async () => {
        const spy = vi.fn();
        const composed = defineMiddleware([
            { onBeforeResponse: vi.fn() }, // no onRequest
            { onRequest: spy },
        ]);
        await composed.onRequest(makeEvent());
        expect(spy).toHaveBeenCalledOnce();
    });

    it('short-circuits when a unit returns a Response', async () => {
        const after = vi.fn();
        const response = new Response('halt');
        const event = makeEvent();
        const composed = defineMiddleware([
            { onRequest: () => response },
            { onRequest: after },
        ]);
        await composed.onRequest(event);
        expect(event.respondWith).toHaveBeenCalledWith(response);
        expect(after).not.toHaveBeenCalled();
    });

    it('short-circuits when a unit marks the event handled', async () => {
        const after = vi.fn();
        const event = makeEvent();
        const composed = defineMiddleware([
            {
                onRequest: (e) => {
                    e.respondWith(new Response('done'));
                },
            },
            { onRequest: after },
        ]);
        await composed.onRequest(event);
        expect(after).not.toHaveBeenCalled();
    });

    it('does not short-circuit when a unit returns undefined', async () => {
        const after = vi.fn();
        const event = makeEvent();
        const composed = defineMiddleware([
            { onRequest: () => undefined },
            { onRequest: after },
        ]);
        await composed.onRequest(event);
        expect(after).toHaveBeenCalledOnce();
        expect(event.respondWith).not.toHaveBeenCalled();
    });
});

describe('defineMiddleware — onBeforeResponse', () => {
    let event: any;
    beforeEach(() => {
        event = makeEvent();
    });

    it('runs all response hooks in array order (no short-circuit)', async () => {
        const calls: number[] = [];
        const composed = defineMiddleware([
            {
                onBeforeResponse: () => {
                    calls.push(1);
                },
            },
            {
                onBeforeResponse: () => {
                    calls.push(2);
                },
            },
        ]);
        await composed.onBeforeResponse(event, { body: 'x' });
        expect(calls).toEqual([1, 2]);
    });

    it('passes the event and response to each hook', async () => {
        const spy = vi.fn();
        const composed = defineMiddleware([{ onBeforeResponse: spy }]);
        const res = { body: { ok: true } };
        await composed.onBeforeResponse(event, res);
        expect(spy).toHaveBeenCalledWith(event, res);
    });

    it('skips units without an onBeforeResponse hook', async () => {
        const spy = vi.fn();
        const composed = defineMiddleware([
            { onRequest: vi.fn() }, // no onBeforeResponse
            { onBeforeResponse: spy },
        ]);
        await composed.onBeforeResponse(event, { body: undefined });
        expect(spy).toHaveBeenCalledOnce();
    });
});
