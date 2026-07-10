import { describe, it, expect, vi, beforeEach } from 'vitest';

const undiciFetch = vi.fn();
vi.mock('undici', () => ({
    fetch: (...a: unknown[]) => undiciFetch(...a),
}));

import Fetch from '../utils/fetch.server';

beforeEach(() => {
    undiciFetch.mockReset();
});

describe('Fetch error responses', () => {
    it('throws the parsed JSON body for a JSON error response', async () => {
        undiciFetch.mockResolvedValue(
            new Response(JSON.stringify({ code: 'NOPE' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            }),
        );
        await expect(Fetch('https://x.test/')).rejects.toEqual({
            code: 'NOPE',
        });
    });

    it('throws the raw Response (not a JSON parse error) when an error status has a non-JSON body', async () => {
        const resp = new Response('<html>bad gateway</html>', { status: 503 });
        undiciFetch.mockResolvedValue(resp);
        // The caller must still see the real status; a SyntaxError from
        // response.json() would mask it.
        await expect(Fetch('https://x.test/')).rejects.toBe(resp);
    });
});
