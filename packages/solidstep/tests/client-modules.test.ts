import { describe, it, expect, vi, beforeEach } from 'vitest';

// loadModule's DEV path resolves imports through the Vite client manifest.
const inputs: Record<string, { import: () => Promise<unknown> }> = {};
vi.mock('vinxi/manifest', () => ({
    getManifest: () => ({ inputs }),
}));

import { preloadHandler, getModule } from '../utils/client-modules';
import type { ClientPageHandler } from '../utils/client-manifest';

const handlerFor = (srcs: string[]): ClientPageHandler =>
    ({
        mainPage: { page: { src: srcs[0] } },
        layouts: srcs.slice(1).map((s) => ({ layout: { src: s } })),
        groups: {},
    }) as unknown as ClientPageHandler;

beforeEach(() => {
    for (const k of Object.keys(inputs)) delete inputs[k];
});

describe('preloadHandler', () => {
    it('loads every module a route needs into the sync cache', async () => {
        inputs['page-ok'] = { import: async () => ({ default: () => 'p' }) };
        await preloadHandler(handlerFor(['page-ok']));
        expect(getModule('page-ok')).toBeDefined();
    });

    it('rejects when a chunk fails to load so callers can fall back to a hard navigation', async () => {
        inputs['page-broken'] = {
            import: async () => {
                throw new Error('chunk load failed');
            },
        };
        // A swallowed failure here would let the router commit a route whose
        // components are missing -> blank page. The rejection must propagate.
        await expect(
            preloadHandler(handlerFor(['page-broken'])),
        ).rejects.toThrow('chunk load failed');
    });
});
