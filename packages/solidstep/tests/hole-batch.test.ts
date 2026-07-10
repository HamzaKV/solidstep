import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('seroval', () => ({ deserialize: (t: string) => JSON.parse(t) }));

import { fetchHoleBatched } from '../utils/hole-batch';

const jsonResponse = (body: unknown, init?: ResponseInit) =>
    ({
        ok: init?.status === undefined || init.status < 400,
        status: init?.status ?? 200,
        text: async () => JSON.stringify(body),
    }) as Response;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
});

describe('fetchHoleBatched', () => {
    it('batches N synchronous calls for the same url into a single fetch', async () => {
        fetchMock.mockResolvedValue(
            jsonResponse({
                results: [
                    { manifest: '/a', data: 1 },
                    { manifest: '/b', data: 2 },
                    { manifest: '/c', data: 3 },
                ],
            }),
        );

        const pA = fetchHoleBatched('/a', '/page');
        const pB = fetchHoleBatched('/b', '/page');
        const pC = fetchHoleBatched('/c', '/page');

        expect(await Promise.all([pA, pB, pC])).toEqual([1, 2, 3]);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const url = new URL(
            fetchMock.mock.calls[0][0] as string,
            'https://example.com',
        );
        expect(url.searchParams.getAll('manifest')).toEqual(['/a', '/b', '/c']);
        expect(url.searchParams.get('url')).toBe('/page');
    });

    it('rejects only the manifest missing from the response, not its siblings', async () => {
        fetchMock.mockResolvedValue(
            jsonResponse({ results: [{ manifest: '/a', data: 1 }] }),
        );

        const pA = fetchHoleBatched('/a', '/page');
        const pB = fetchHoleBatched('/b', '/page');

        await expect(pA).resolves.toBe(1);
        await expect(pB).rejects.toThrow(/No response/);
    });

    it('rejects a manifest whose result carries a per-item error', async () => {
        fetchMock.mockResolvedValue(
            jsonResponse({ results: [{ manifest: '/a', error: 'boom' }] }),
        );

        await expect(fetchHoleBatched('/a', '/page')).rejects.toThrow('boom');
    });

    it('a whole-request failure (non-ok status) rejects every queued waiter', async () => {
        fetchMock.mockResolvedValue(jsonResponse('', { status: 500 }));

        const pA = fetchHoleBatched('/a', '/page');
        const pB = fetchHoleBatched('/b', '/page');

        await expect(pA).rejects.toThrow(/Hole fetch failed/);
        await expect(pB).rejects.toThrow(/Hole fetch failed/);
    });

    it('a network-level fetch rejection rejects every queued waiter', async () => {
        fetchMock.mockRejectedValue(new Error('network down'));

        const pA = fetchHoleBatched('/a', '/page');
        const pB = fetchHoleBatched('/b', '/page');

        await expect(pA).rejects.toThrow('network down');
        await expect(pB).rejects.toThrow('network down');
    });

    it('does not merge calls for different urls into one batch', async () => {
        fetchMock.mockImplementation(async (input: string) => {
            const url = new URL(input, 'https://example.com');
            const target = url.searchParams.get('url')!;
            return jsonResponse({
                results: [{ manifest: '/a', data: target }],
            });
        });

        const pOne = fetchHoleBatched('/a', '/page-one');
        const pTwo = fetchHoleBatched('/a', '/page-two');

        expect(await pOne).toBe('/page-one');
        expect(await pTwo).toBe('/page-two');
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('two calls for the same manifest+url share one server run and both resolve', async () => {
        fetchMock.mockResolvedValue(
            jsonResponse({ results: [{ manifest: '/a', data: 42 }] }),
        );

        const p1 = fetchHoleBatched('/a', '/page');
        const p2 = fetchHoleBatched('/a', '/page');

        expect(await Promise.all([p1, p2])).toEqual([42, 42]);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const url = new URL(
            fetchMock.mock.calls[0][0] as string,
            'https://example.com',
        );
        // Deduped in the outgoing request, not sent twice.
        expect(url.searchParams.getAll('manifest')).toEqual(['/a']);
    });

    it('a call arriving while a batch is already in flight starts a NEW batch (does not hang)', async () => {
        let resolveFirst!: (v: Response) => void;
        fetchMock.mockImplementationOnce(
            () =>
                new Promise<Response>((r) => {
                    resolveFirst = r;
                }),
        );

        const pFirst = fetchHoleBatched('/a', '/page');
        // Let the first batch's microtask flush and issue its fetch (still
        // pending -- resolveFirst hasn't been called yet).
        await Promise.resolve();
        await Promise.resolve();
        expect(fetchMock).toHaveBeenCalledTimes(1);

        // A second call for the SAME url, while the first request is still
        // in flight, must be queued into a fresh batch (its own fetch), not
        // silently appended to the already-sent request.
        fetchMock.mockResolvedValueOnce(
            jsonResponse({ results: [{ manifest: '/b', data: 'second' }] }),
        );
        const pSecond = fetchHoleBatched('/b', '/page');

        resolveFirst(
            jsonResponse({ results: [{ manifest: '/a', data: 'first' }] }),
        );

        expect(await pFirst).toBe('first');
        expect(await pSecond).toBe('second');
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});
