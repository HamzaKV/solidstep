import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fuzzString, makeRng } from './fuzz-helpers';

vi.mock('../utils/cache.js', () => ({
    invalidateCache: vi.fn(async () => undefined),
    invalidateTag: vi.fn(async () => undefined),
}));

const ORIGINAL_TOKEN = process.env.SOLIDSTEP_REVALIDATE_TOKEN;

describe('handleRevalidate', () => {
    beforeEach(() => {
        process.env.SOLIDSTEP_REVALIDATE_TOKEN = 'the-real-token';
        vi.resetModules();
    });

    afterEach(() => {
        process.env.SOLIDSTEP_REVALIDATE_TOKEN = ORIGINAL_TOKEN;
    });

    it('rejects a GET with 405', async () => {
        const { handleRevalidate } = await import('../server/revalidate');
        const req = new Request('http://localhost/__solidstep_revalidate', {
            method: 'GET',
        });
        const res = await handleRevalidate(req);
        expect(res.status).toBe(405);
    });

    it('rejects every token when SOLIDSTEP_REVALIDATE_TOKEN is unset, even an empty one', async () => {
        delete process.env.SOLIDSTEP_REVALIDATE_TOKEN;
        const { handleRevalidate } = await import('../server/revalidate');
        const req = new Request('http://localhost/__solidstep_revalidate', {
            method: 'POST',
            headers: { authorization: 'Bearer ' },
            body: JSON.stringify({ path: '/foo' }),
        });
        const res = await handleRevalidate(req);
        expect(res.status).toBe(401);
    });

    it('rejects a POST with no Authorization header with 401', async () => {
        const { handleRevalidate } = await import('../server/revalidate');
        const req = new Request('http://localhost/__solidstep_revalidate', {
            method: 'POST',
            body: JSON.stringify({ path: '/foo' }),
        });
        const res = await handleRevalidate(req);
        expect(res.status).toBe(401);
    });

    it('accepts the Bearer scheme case-insensitively (RFC 7235)', async () => {
        const { handleRevalidate } = await import('../server/revalidate');
        const req = new Request('http://localhost/__solidstep_revalidate', {
            method: 'POST',
            headers: { authorization: 'bearer the-real-token' },
            body: JSON.stringify({ path: '/foo' }),
        });
        const res = await handleRevalidate(req);
        expect(res.status).toBe(200);
    });

    it('rejects a POST with the wrong token with 401', async () => {
        const { handleRevalidate } = await import('../server/revalidate');
        const req = new Request('http://localhost/__solidstep_revalidate', {
            method: 'POST',
            headers: { authorization: 'Bearer wrong-token' },
            body: JSON.stringify({ path: '/foo' }),
        });
        const res = await handleRevalidate(req);
        expect(res.status).toBe(401);
    });

    it('with a valid token and { path }, invalidates both the page-cache and ISR keys for that path', async () => {
        const { handleRevalidate } = await import('../server/revalidate');
        const { invalidateCache } = await import('../utils/cache.js');
        const req = new Request('http://localhost/__solidstep_revalidate', {
            method: 'POST',
            headers: { authorization: 'Bearer the-real-token' },
            body: JSON.stringify({ path: '/products' }),
        });

        const res = await handleRevalidate(req);

        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual({
            revalidated: true,
            path: '/products',
        });
        expect(invalidateCache).toHaveBeenCalledWith('/products');
        expect(invalidateCache).toHaveBeenCalledWith('isr:/products');
    });

    it('with a valid token and { path }, also invalidates the preview-namespaced page-cache entry', async () => {
        // Preview mode's page-render cache write uses a `preview:`-prefixed
        // key (see render.ts/isPreviewActive), sharing the same one draft
        // namespace across every preview session -- without this, an
        // editor's draft stays stale in preview after a { path } revalidate
        // call, defeating preview mode's whole "see your edit immediately"
        // purpose.
        const { handleRevalidate } = await import('../server/revalidate');
        const { invalidateCache } = await import('../utils/cache.js');
        const req = new Request('http://localhost/__solidstep_revalidate', {
            method: 'POST',
            headers: { authorization: 'Bearer the-real-token' },
            body: JSON.stringify({ path: '/products' }),
        });

        await handleRevalidate(req);

        expect(invalidateCache).toHaveBeenCalledWith('preview:/products');
    });

    it('with a valid token and { tag }, calls invalidateTag', async () => {
        const { handleRevalidate } = await import('../server/revalidate');
        const { invalidateTag } = await import('../utils/cache.js');
        const req = new Request('http://localhost/__solidstep_revalidate', {
            method: 'POST',
            headers: { authorization: 'Bearer the-real-token' },
            body: JSON.stringify({ tag: 'products' }),
        });

        const res = await handleRevalidate(req);

        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual({
            revalidated: true,
            tag: 'products',
        });
        expect(invalidateTag).toHaveBeenCalledWith('products');
    });

    it('with a valid token and both { path, tag }, invalidates both instead of silently dropping one', async () => {
        const { handleRevalidate } = await import('../server/revalidate');
        const { invalidateCache, invalidateTag } = await import(
            '../utils/cache.js'
        );
        const req = new Request('http://localhost/__solidstep_revalidate', {
            method: 'POST',
            headers: { authorization: 'Bearer the-real-token' },
            body: JSON.stringify({ path: '/products', tag: 'products' }),
        });

        const res = await handleRevalidate(req);

        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual({
            revalidated: true,
            path: '/products',
            tag: 'products',
        });
        expect(invalidateCache).toHaveBeenCalledWith('/products');
        expect(invalidateCache).toHaveBeenCalledWith('isr:/products');
        expect(invalidateTag).toHaveBeenCalledWith('products');
    });

    it('rejects an oversized body before parsing it, with 413', async () => {
        const { handleRevalidate } = await import('../server/revalidate');
        const oversized = JSON.stringify({ path: `/${'a'.repeat(20_000)}` });
        const req = new Request('http://localhost/__solidstep_revalidate', {
            method: 'POST',
            headers: {
                authorization: 'Bearer the-real-token',
                'content-length': String(oversized.length),
            },
            body: oversized,
        });
        const res = await handleRevalidate(req);
        expect(res.status).toBe(413);
    });

    it('rejects a malformed JSON body with 400', async () => {
        const { handleRevalidate } = await import('../server/revalidate');
        const req = new Request('http://localhost/__solidstep_revalidate', {
            method: 'POST',
            headers: { authorization: 'Bearer the-real-token' },
            body: 'not json',
        });
        const res = await handleRevalidate(req);
        expect(res.status).toBe(400);
    });

    it('rejects a body with neither path nor tag with 400', async () => {
        const { handleRevalidate } = await import('../server/revalidate');
        const req = new Request('http://localhost/__solidstep_revalidate', {
            method: 'POST',
            headers: { authorization: 'Bearer the-real-token' },
            body: JSON.stringify({}),
        });
        const res = await handleRevalidate(req);
        expect(res.status).toBe(400);
    });

    describe('fuzzing', () => {
        it('never throws and never returns 200 without the exact correct token, for any Authorization header value', async () => {
            const { handleRevalidate } = await import('../server/revalidate');
            const rng = makeRng(1);
            const VALID_STATUSES = [200, 400, 401, 405, 413];
            for (let i = 0; i < 1500; i++) {
                const authHeader = fuzzString(rng);
                let req: Request;
                try {
                    // A header value containing control chars (e.g. a
                    // newline) is rejected by the Headers API itself -- such
                    // a request could never arrive at our handler in the
                    // first place (the HTTP layer rejects it first), so
                    // that's not a finding about handleRevalidate.
                    req = new Request(
                        'http://localhost/__solidstep_revalidate',
                        {
                            method: 'POST',
                            headers: { authorization: authHeader },
                            body: JSON.stringify({ path: '/x' }),
                        },
                    );
                } catch {
                    continue;
                }
                let res: { status: number; body: string };
                try {
                    res = await handleRevalidate(req);
                } catch (err) {
                    throw new Error(
                        `iteration ${i} (auth=${JSON.stringify(authHeader)}) threw: ${err instanceof Error ? err.message : String(err)}`,
                    );
                }
                expect(VALID_STATUSES, `iteration ${i}`).toContain(res.status);
                if (res.status === 200) {
                    expect(
                        authHeader.toLowerCase(),
                        `iteration ${i}: got 200 with a wrong-looking token`,
                    ).toBe('bearer the-real-token');
                }
            }
        });

        it('never throws for any raw request body, regardless of Content-Length or JSON validity', async () => {
            const { handleRevalidate } = await import('../server/revalidate');
            const rng = makeRng(2);
            for (let i = 0; i < 1000; i++) {
                const rawBody = fuzzString(rng);
                const req = new Request(
                    'http://localhost/__solidstep_revalidate',
                    {
                        method: 'POST',
                        headers: {
                            authorization: 'Bearer the-real-token',
                            'content-length': String(
                                rng.bool()
                                    ? rawBody.length
                                    : rng.int(0, 50_000), // sometimes lie
                            ),
                        },
                        body: rawBody,
                    },
                );
                try {
                    await handleRevalidate(req);
                } catch (err) {
                    throw new Error(
                        `iteration ${i} (body=${JSON.stringify(rawBody.slice(0, 50))}) threw: ${err instanceof Error ? err.message : String(err)}`,
                    );
                }
            }
        });
    });

    describe('load: high-concurrency invalidation calls', () => {
        it('a large burst of concurrent path/tag invalidations all succeed with no crash or dropped call', async () => {
            const { handleRevalidate } = await import('../server/revalidate');
            const { invalidateCache, invalidateTag } = await import(
                '../utils/cache.js'
            );
            // Other tests in this file share these module-level mocks and
            // don't reset them (they only assert toHaveBeenCalledWith, not
            // counts) -- clear here since this test counts exact calls.
            vi.mocked(invalidateCache).mockClear();
            vi.mocked(invalidateTag).mockClear();
            const N = 200;
            const requests = Array.from({ length: N }, (_, i) =>
                i % 2 === 0
                    ? new Request('http://localhost/__solidstep_revalidate', {
                          method: 'POST',
                          headers: { authorization: 'Bearer the-real-token' },
                          body: JSON.stringify({ path: `/item-${i}` }),
                      })
                    : new Request('http://localhost/__solidstep_revalidate', {
                          method: 'POST',
                          headers: { authorization: 'Bearer the-real-token' },
                          body: JSON.stringify({ tag: `tag-${i}` }),
                      }),
            );

            const results = await Promise.all(
                requests.map((req) => handleRevalidate(req)),
            );

            for (let i = 0; i < N; i++) {
                expect(results[i].status, `request ${i}`).toBe(200);
            }
            expect(invalidateCache).toHaveBeenCalledTimes(
                (N / 2) * 3, // path + preview:path + isr:path, per path call
            );
            expect(invalidateTag).toHaveBeenCalledTimes(N / 2);
        });
    });
});
