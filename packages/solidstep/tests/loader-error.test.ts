import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vinxi/http', () => ({
    getEvent: vi.fn(),
    setResponseHeader: vi.fn(),
}));

import { runSequentialLoader, LOADER_ERROR_KEY } from '../utils/loader-error';
import { clearAllCache } from '../utils/cache';

const req = () => new Request('https://example.com/p');

const okLoader = (data: unknown) => ({
    loader: vi.fn(async () => ({ data })),
    options: {},
});
const throwingLoader = (err: unknown) => ({
    loader: vi.fn(async () => {
        throw err;
    }),
    options: {},
});

beforeEach(async () => {
    await clearAllCache();
});

describe('runSequentialLoader', () => {
    it('returns loader data on success', async () => {
        const data = await runSequentialLoader(
            okLoader({ n: 1 }),
            '/layout',
            req(),
            false,
        );
        expect(data).toEqual({ n: 1 });
    });

    it('isolates a layout/group loader failure as a serializable sentinel', async () => {
        const data = await runSequentialLoader(
            throwingLoader(new Error('db down')),
            '/layout',
            req(),
            false,
        );
        expect(data).toEqual({ [LOADER_ERROR_KEY]: 'db down' });
        // Must survive the hydration JSON.stringify.
        expect(JSON.parse(JSON.stringify(data))).toEqual({
            [LOADER_ERROR_KEY]: 'db down',
        });
    });

    it('stringifies a non-Error throw in the sentinel', async () => {
        const data = await runSequentialLoader(
            throwingLoader('plain string'),
            '/layout',
            req(),
            false,
        );
        expect(data).toEqual({ [LOADER_ERROR_KEY]: 'plain string' });
    });

    it('re-throws a RedirectError from a layout/group loader (auth gating)', async () => {
        const { RedirectError } = await import('../utils/redirect');
        await expect(
            runSequentialLoader(
                throwingLoader(new RedirectError('/login')),
                '/layout',
                req(),
                false,
            ),
        ).rejects.toThrow('/login');
    });

    it('re-throws when the failing loader is the page loader', async () => {
        await expect(
            runSequentialLoader(
                throwingLoader(new Error('boom')),
                '/page',
                req(),
                true,
            ),
        ).rejects.toThrow('boom');
    });
});
