import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The client router runtime pulls in vinxi's manifest, which needs the vinxi
// dev/build runtime globals this test doesn't set up -- it's irrelevant to
// the redirect-handling behavior under test here.
vi.mock('../utils/router-context', () => ({
    refreshRoute: vi.fn(async () => undefined),
}));

import { createServerReference } from '../utils/server-action.client';

describe('createServerReference (client) -- redirect handling', () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    let devOverlayMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        devOverlayMock = vi.fn();
        (globalThis as any).window = {
            location: { href: '' },
            __solidstepDevOverlay: devOverlayMock,
        };
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        (globalThis as any).window = undefined;
    });

    it('navigates via window.location.href and resolves without throwing when the action redirects', async () => {
        fetchMock.mockResolvedValue(
            new Response(
                JSON.stringify({
                    name: 'RedirectError',
                    message: '/dashboard',
                }),
                {
                    status: 200,
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Error': 'true',
                    },
                },
            ),
        );

        const action = createServerReference(async () => {}, 'id', 'name');

        await expect(action()).resolves.toBeUndefined();
        expect((globalThis as any).window.location.href).toBe('/dashboard');
        expect(devOverlayMock).not.toHaveBeenCalled();
    });

    it('still throws for a non-redirect action error', async () => {
        fetchMock.mockResolvedValue(
            new Response(JSON.stringify({ name: 'Error', message: 'boom' }), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'X-Error': 'true',
                },
            }),
        );

        const action = createServerReference(async () => {}, 'id', 'name');

        await expect(action()).rejects.toMatchObject({ message: 'boom' });
    });
});
