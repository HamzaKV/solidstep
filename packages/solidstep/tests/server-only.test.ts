import { describe, it, expect, vi, beforeEach } from 'vitest';

// `server-only` is a guard module: importing it throws on the client and is a
// no-op on the server. It reads `isServer` from 'solid-js/web' at module load,
// so each block remocks it and re-imports to cover both branches (same pattern
// as loader.test.ts).

describe('server-only', () => {
    beforeEach(() => vi.resetModules());

    it('does not throw when imported on the server', async () => {
        vi.doMock('solid-js/web', () => ({ isServer: true }));
        await expect(import('../utils/server-only')).resolves.toBeDefined();
    });

    it('throws when imported on the client', async () => {
        vi.doMock('solid-js/web', () => ({ isServer: false }));
        await expect(import('../utils/server-only')).rejects.toThrow(
            'This module is only available on the server side.',
        );
    });
});
