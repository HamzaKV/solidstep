import { describe, it, expect, vi, beforeEach } from 'vitest';

// `defineLoader` gates on `isServer` from 'solid-js/web'. Each block remocks it
// and re-imports the module so both the server and client branches are covered.

describe('defineLoader (server)', () => {
    beforeEach(() => vi.resetModules());

    it('returns { loader, options } and wraps the result as { data, type }', async () => {
        vi.doMock('solid-js/web', () => ({ isServer: true }));
        const { defineLoader } = await import('../utils/loader');

        const def = defineLoader(async () => ({ hello: 'world' }));
        expect(def).not.toBeNull();
        expect(def?.options).toEqual({});

        const resolved = await def!.loader(undefined);
        expect(resolved).toEqual({
            data: { hello: 'world' },
            type: 'sequential',
        });
    });

    it("defaults the type to 'sequential' and honors an explicit 'defer'", async () => {
        vi.doMock('solid-js/web', () => ({ isServer: true }));
        const { defineLoader } = await import('../utils/loader');

        const seq = defineLoader(async () => 1);
        expect((await seq!.loader()).type).toBe('sequential');

        const deferred = defineLoader(async () => 2, { type: 'defer' });
        expect(deferred?.options).toEqual({ type: 'defer' });
        expect((await deferred!.loader()).type).toBe('defer');
    });

    it('passes the Request and context through to the underlying loader', async () => {
        vi.doMock('solid-js/web', () => ({ isServer: true }));
        const { defineLoader } = await import('../utils/loader');

        const spy = vi.fn(async (_req?: Request) => 'ok');
        const def = defineLoader(spy);
        const request = new Request('https://example.com/');
        const context = { locals: { cspNonce: 'abc' } };
        await def!.loader(request, context);
        expect(spy).toHaveBeenCalledWith(request, context);
    });
});

describe('defineLoader (client)', () => {
    beforeEach(() => vi.resetModules());

    it('returns null so the loader is never exposed to the client', async () => {
        vi.doMock('solid-js/web', () => ({ isServer: false }));
        const { defineLoader } = await import('../utils/loader');

        expect(defineLoader(async () => ({ hello: 'world' }))).toBeNull();
    });
});
