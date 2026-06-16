import { describe, it, expect, vi, beforeEach } from 'vitest';

// serveRouteData encodes redirects/errors/not-found into a serialized envelope
// (rather than HTTP status) for the soft-nav client. seroval is mocked to an
// identity so the envelope object can be inspected directly. data-endpoints.ts is
// excluded from the coverage gate (covered by E2E); these are behavioral checks.

const matchRoute = vi.fn();
const runSequentialLoader = vi.fn(async () => ({}));

vi.mock('seroval', () => ({ serialize: (v: unknown) => v }));
vi.mock('../utils/serialize', () => ({ SEROVAL_PLUGINS: [] }));
vi.mock('../server/route-manifest', () => ({
    ensureRouteManifest: async () => ({}),
    getCachedModule: async (imp: { import: () => unknown }) => imp.import(),
}));
vi.mock('../utils/path-router', () => ({
    matchRoute: (...a: unknown[]) => matchRoute(...a),
    parseSearchParams: () => ({}),
}));
vi.mock('../utils/loader-error', () => ({
    runSequentialLoader: (...a: unknown[]) => runSequentialLoader(...a),
}));
vi.mock('../utils/loader-cache', () => ({
    getCachedLoaderData: async () => ({}),
}));

import { serveRouteData } from '../server/data-endpoints';
import { RedirectError } from '../utils/redirect';

const req = (url = 'route') =>
    new Request(`https://example.com/__route?url=${url}`);

beforeEach(() => {
    matchRoute.mockReset();
    runSequentialLoader.mockReset().mockResolvedValue({});
});

describe('serveRouteData', () => {
    it('returns null when the url param is missing', async () => {
        const body = await serveRouteData(new Request('https://example.com/x'));
        expect(body).toBeNull();
    });

    it('encodes a not-found envelope when no route matches', async () => {
        matchRoute.mockReturnValue(undefined);
        const body = (await serveRouteData(req())) as unknown as {
            type: string;
        };
        expect(body.type).toBe('not-found');
    });

    it('encodes a route envelope for an API route match', async () => {
        matchRoute.mockReturnValue({ handler: { type: 'route' }, params: {} });
        const body = (await serveRouteData(req())) as unknown as {
            type: string;
        };
        expect(body.type).toBe('route');
    });

    it('encodes a redirect envelope when a page loader redirects', async () => {
        matchRoute.mockReturnValue({
            handler: {
                type: 'page',
                mainPage: {
                    manifestPath: '/p',
                    loader: { src: 'l', import: () => ({ loader: {} }) },
                },
                layouts: [],
            },
            params: {},
        });
        runSequentialLoader.mockRejectedValue(new RedirectError('/login'));
        const body = (await serveRouteData(req())) as unknown as {
            type: string;
            location: string;
        };
        expect(body.type).toBe('redirect');
        expect(body.location).toBe('/login');
    });
});
