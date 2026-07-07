import { describe, it, expect, vi, beforeEach } from 'vitest';

// defineConfig computes a `middlewarePath` (.ts, falling back to .js) but the
// ssr router config hardcoded the literal './app/middleware.ts' instead of
// using it — a project with only app/middleware.js (or no middleware file at
// all) silently got the wrong (or a nonexistent) middleware wired in. These
// tests drive defineConfig with `vinxi`'s createApp mocked to an identity
// capture, so the resulting router config can be inspected directly.

const existsSyncMock = vi.fn();

vi.mock('vinxi', () => ({
    createApp: vi.fn((config: any) => ({
        ...config,
        hooks: { afterEach: vi.fn() },
    })),
}));
vi.mock('vite-plugin-solid', () => ({ default: () => ({}) }));
vi.mock('@vinxi/server-functions/plugin', () => ({
    serverFunctions: { client: () => ({}), server: () => ({}) },
}));
vi.mock('../utils/router', () => ({
    ServerRouter: class {},
    ClientRouter: class {},
}));
vi.mock('vinxi/lib/path', () => ({ normalize: (p: string) => p }));
vi.mock('vinxi/plugins/config', () => ({ config: () => ({}) }));
vi.mock('../utils/typegen', () => ({ routeTypegen: () => ({}) }));
vi.mock('node:fs', () => ({
    existsSync: (...a: unknown[]) => existsSyncMock(...a),
    mkdirSync: vi.fn(),
    cpSync: vi.fn(),
    writeFileSync: vi.fn(),
}));

import { defineConfig } from '../index';

const ssrRouter = (app: any) =>
    app.routers.find((r: { name: string }) => r.name === 'ssr');

beforeEach(() => {
    existsSyncMock.mockReset();
});

describe('defineConfig middleware resolution', () => {
    it('wires app/middleware.ts when it exists', () => {
        existsSyncMock.mockImplementation((p: string) =>
            p.endsWith('middleware.ts'),
        );
        const app = defineConfig();
        expect(ssrRouter(app).middleware).toBe('./app/middleware.ts');
    });

    it('falls back to app/middleware.js when only it exists', () => {
        existsSyncMock.mockImplementation((p: string) =>
            p.endsWith('middleware.js'),
        );
        const app = defineConfig();
        expect(ssrRouter(app).middleware).toBe('./app/middleware.js');
    });

    it('leaves middleware undefined when neither file exists', () => {
        existsSyncMock.mockReturnValue(false);
        const app = defineConfig();
        expect(ssrRouter(app).middleware).toBeUndefined();
    });
});
