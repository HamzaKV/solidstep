import { describe, it, expect, beforeEach } from 'vitest';

// Reset the module between each test so the singleton `logger` variable is cleared.
beforeEach(() => {
    vi.resetModules();
    // Remove any previously set config
    (globalThis as any).__SOLIDSTEP_CONFIG__ = undefined;
});

import { vi } from 'vitest';

describe('getLogger', () => {
    it('creates a silent logger when config is false', async () => {
        (globalThis as any).__SOLIDSTEP_CONFIG__ = { logger: false };
        const { getLogger } = await import('../utils/pino.ts');
        const logger = getLogger();
        expect(logger.level).toBe('silent');
    });

    it('creates a silent logger when config is undefined', async () => {
        (globalThis as any).__SOLIDSTEP_CONFIG__ = { logger: undefined };
        const { getLogger } = await import('../utils/pino.ts');
        const logger = getLogger();
        expect(logger.level).toBe('silent');
    });

    it('creates a silent logger when __SOLIDSTEP_CONFIG__ is not set at all', async () => {
        const { getLogger } = await import('../utils/pino.ts');
        const logger = getLogger();
        expect(logger.level).toBe('silent');
    });

    it('creates a default pino logger when config is true', async () => {
        (globalThis as any).__SOLIDSTEP_CONFIG__ = { logger: true };
        const { getLogger } = await import('../utils/pino.ts');
        const logger = getLogger();
        // default pino level is 'info'
        expect(logger.level).toBe('info');
    });

    it('applies a custom config object', async () => {
        (globalThis as any).__SOLIDSTEP_CONFIG__ = {
            logger: { level: 'warn' },
        };
        const { getLogger } = await import('../utils/pino.ts');
        const logger = getLogger();
        expect(logger.level).toBe('warn');
    });

    it('returns the same cached instance on repeated calls', async () => {
        (globalThis as any).__SOLIDSTEP_CONFIG__ = { logger: true };
        const { getLogger } = await import('../utils/pino.ts');
        const a = getLogger();
        const b = getLogger();
        expect(a).toBe(b);
    });
});
