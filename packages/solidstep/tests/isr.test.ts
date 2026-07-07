import { describe, it, expect, vi, beforeEach } from 'vitest';

// isr.ts serves cached full-HTML artifacts with stale-while-revalidate and
// seeds them from the build-time prerender manifest at startup. These pin
// its current behavior through `serveIsr` / `seedIsrFromManifest`.
// `single-flight.ts` is pure logic with no side effects, so it's used for
// real (not mocked).

const getCacheEntry = vi.fn();
const setCacheWithOptions = vi.fn(async () => undefined);
const fetchServer = vi.fn();
const readFile = vi.fn();
const logger = vi.hoisted(() => ({
    warn: vi.fn(),
    debug: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
    readFile: (...a: unknown[]) => readFile(...a),
}));
vi.mock('../utils/cache', () => ({
    getCacheEntry: (...a: unknown[]) => getCacheEntry(...a),
    setCacheWithOptions: (...a: unknown[]) => setCacheWithOptions(...a),
}));
vi.mock('../utils/fetch.server', () => ({
    default: (...a: unknown[]) => fetchServer(...a),
}));
vi.mock('../utils/logger', () => ({ logger }));

import { serveIsr, seedIsrFromManifest, ISR_SWR_MAX } from '../server/isr';

beforeEach(() => {
    getCacheEntry.mockReset();
    setCacheWithOptions.mockReset().mockResolvedValue(undefined);
    fetchServer.mockReset();
    readFile.mockReset();
    logger.warn.mockClear();
    logger.debug.mockClear();
});

describe('serveIsr', () => {
    it('returns a fresh cache hit without regenerating', async () => {
        getCacheEntry.mockResolvedValue({
            value: '<html>fresh</html>',
            staleAt: Date.now() + 60_000,
        });

        const result = await serveIsr('https://x.test', '/p', 60);

        expect(result).toEqual({
            html: '<html>fresh</html>',
            cacheStatus: 'hit',
        });
        expect(fetchServer).not.toHaveBeenCalled();
    });

    it('treats a null staleAt as always-fresh', async () => {
        getCacheEntry.mockResolvedValue({
            value: '<html>evergreen</html>',
            staleAt: null,
        });

        const result = await serveIsr('https://x.test', '/p', 60);

        expect(result.cacheStatus).toBe('hit');
        expect(fetchServer).not.toHaveBeenCalled();
    });

    it('serves the stale artifact immediately and regenerates in the background', async () => {
        getCacheEntry.mockResolvedValue({
            value: '<html>stale</html>',
            staleAt: Date.now() - 1,
        });
        fetchServer.mockResolvedValue({
            text: async () => '<html>fresh</html>',
        });

        const result = await serveIsr('https://x.test', '/p', 60, ['tag']);

        // The stale value is returned before the background regen settles.
        expect(result).toEqual({
            html: '<html>stale</html>',
            cacheStatus: 'hit',
        });
        await vi.waitFor(() => expect(setCacheWithOptions).toHaveBeenCalled());
        expect(fetchServer).toHaveBeenCalledWith(
            'https://x.test/p',
            expect.objectContaining({ method: 'GET' }),
            false,
        );
        expect(setCacheWithOptions).toHaveBeenCalledWith(
            'isr:/p',
            '<html>fresh</html>',
            { ttl: 60_000, swr: ISR_SWR_MAX, tags: ['tag'] },
        );
    });

    it('logs a warning and keeps serving stale when background regeneration fails', async () => {
        getCacheEntry.mockResolvedValue({
            value: '<html>stale</html>',
            staleAt: Date.now() - 1,
        });
        fetchServer.mockRejectedValue(new Error('upstream down'));

        const result = await serveIsr('https://x.test', '/p', 60);

        expect(result.cacheStatus).toBe('hit');
        await vi.waitFor(() => expect(logger.warn).toHaveBeenCalled());
        expect(logger.warn).toHaveBeenCalledWith(
            expect.objectContaining({ pathname: '/p' }),
            expect.stringContaining('background revalidation failed'),
        );
    });

    it('renders on demand for a cold miss', async () => {
        getCacheEntry.mockResolvedValue(null);
        fetchServer.mockResolvedValue({ text: async () => '<html>new</html>' });

        const result = await serveIsr('https://x.test', '/p', 30);

        expect(result).toEqual({
            html: '<html>new</html>',
            cacheStatus: 'miss',
        });
        expect(setCacheWithOptions).toHaveBeenCalledWith(
            'isr:/p',
            '<html>new</html>',
            { ttl: 30_000, swr: ISR_SWR_MAX, tags: undefined },
        );
    });
});

describe('seedIsrFromManifest', () => {
    it('does nothing (logs at debug) when the manifest file is missing', async () => {
        readFile.mockRejectedValue(new Error('ENOENT'));

        await seedIsrFromManifest('/out');

        expect(logger.debug).toHaveBeenCalled();
        expect(setCacheWithOptions).not.toHaveBeenCalled();
    });

    it('logs a warning and skips seeding when the manifest is not valid JSON', async () => {
        readFile.mockResolvedValueOnce('not json{');

        await seedIsrFromManifest('/out');

        expect(logger.warn).toHaveBeenCalled();
        expect(setCacheWithOptions).not.toHaveBeenCalled();
    });

    it('seeds each ISR entry from its prerendered artifact', async () => {
        readFile
            .mockResolvedValueOnce(
                JSON.stringify({
                    isr: [
                        {
                            pathname: '/a',
                            revalidate: 30,
                            tags: ['t1'],
                            file: 'a.html',
                        },
                    ],
                }),
            )
            .mockResolvedValueOnce('<html>a</html>');

        await seedIsrFromManifest('/out');

        expect(setCacheWithOptions).toHaveBeenCalledWith(
            'isr:/a',
            '<html>a</html>',
            { ttl: 30_000, swr: ISR_SWR_MAX, tags: ['t1'] },
        );
    });

    it('skips (logs at debug) a missing artifact but leaves other entries unaffected', async () => {
        readFile
            .mockResolvedValueOnce(
                JSON.stringify({
                    isr: [
                        {
                            pathname: '/missing',
                            revalidate: 60,
                            file: 'gone.html',
                        },
                        { pathname: '/ok', revalidate: 60, file: 'ok.html' },
                    ],
                }),
            )
            .mockRejectedValueOnce(new Error('ENOENT'))
            .mockResolvedValueOnce('<html>ok</html>');

        await seedIsrFromManifest('/out');

        expect(logger.debug).toHaveBeenCalledWith(
            expect.objectContaining({ pathname: '/missing' }),
            expect.any(String),
        );
        expect(setCacheWithOptions).toHaveBeenCalledTimes(1);
        expect(setCacheWithOptions).toHaveBeenCalledWith(
            'isr:/ok',
            '<html>ok</html>',
            expect.objectContaining({ ttl: 60_000 }),
        );
    });

    it('does nothing when the manifest has no isr entries at all', async () => {
        readFile.mockResolvedValueOnce(JSON.stringify({}));

        await seedIsrFromManifest('/out');

        expect(setCacheWithOptions).not.toHaveBeenCalled();
    });

    it('defaults to a 60s revalidate when an entry omits it (falsy)', async () => {
        readFile
            .mockResolvedValueOnce(
                JSON.stringify({
                    isr: [{ pathname: '/a', revalidate: 0, file: 'a.html' }],
                }),
            )
            .mockResolvedValueOnce('<html>a</html>');

        await seedIsrFromManifest('/out');

        expect(setCacheWithOptions).toHaveBeenCalledWith(
            'isr:/a',
            '<html>a</html>',
            expect.objectContaining({ ttl: 60_000 }),
        );
    });
});
