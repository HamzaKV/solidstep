import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    registerShutdownHandler,
    createRequestContext,
    type InstrumentationModule,
} from '../utils/instrumentation';

// onShutdown was declared on InstrumentationModule but never invoked anywhere
// in the framework. registerShutdownHandler wires it to SIGTERM/SIGINT/
// beforeExit, firing at most once even if multiple signals arrive.

describe('registerShutdownHandler', () => {
    afterEach(() => {
        process.removeAllListeners('SIGTERM');
        process.removeAllListeners('SIGINT');
        process.removeAllListeners('beforeExit');
    });

    it('fires onShutdown exactly once, even when multiple signals arrive', async () => {
        const onShutdown = vi.fn();
        registerShutdownHandler({ onShutdown } as InstrumentationModule);

        process.emit('SIGTERM' as any);
        process.emit('SIGINT' as any);
        await new Promise((r) => setImmediate(r));

        expect(onShutdown).toHaveBeenCalledTimes(1);
    });

    it('does nothing when no onShutdown hook is provided', () => {
        expect(() => registerShutdownHandler(null)).not.toThrow();
        expect(() => registerShutdownHandler({})).not.toThrow();
    });
});

describe('createRequestContext', () => {
    it('parses the request URL when pathname/searchParams are not supplied', () => {
        const ctx = createRequestContext(
            new Request('https://example.com/p?q=1'),
        );
        expect(ctx.pathname).toBe('/p');
        expect(ctx.searchParams).toEqual({ q: '1' });
    });

    it('skips parsing req.url when both pathname and searchParams are supplied', () => {
        // A request whose .url getter throws proves createRequestContext never
        // touches it when the caller already parsed the URL itself.
        const req = {
            get url(): string {
                throw new Error('req.url should not be read');
            },
        } as unknown as Request;
        const ctx = createRequestContext(req, {
            pathname: '/already-parsed',
            searchParams: { x: '1' },
        });
        expect(ctx.pathname).toBe('/already-parsed');
        expect(ctx.searchParams).toEqual({ x: '1' });
    });

    it('parses req.url when only one of pathname/searchParams is supplied', () => {
        const ctx = createRequestContext(
            new Request('https://example.com/fallback?y=2'),
            { pathname: '/explicit' },
        );
        expect(ctx.pathname).toBe('/explicit');
        expect(ctx.searchParams).toEqual({ y: '2' });
    });
});

describe('isMissingInstrumentationModule', () => {
    it('treats a missing instrumentation module itself as "no instrumentation"', async () => {
        const { isMissingInstrumentationModule } = await import(
            '../utils/instrumentation'
        );
        const e = Object.assign(
            new Error(
                "Cannot find module '/app/instrumentation.ts' imported from /srv/server.mjs",
            ),
            { code: 'ERR_MODULE_NOT_FOUND' },
        );
        expect(isMissingInstrumentationModule(e)).toBe(true);
        expect(
            isMissingInstrumentationModule(
                new Error("Cannot find module 'instrumentation'"),
            ),
        ).toBe(true);
    });

    it('does NOT swallow a missing dependency imported BY the user instrumentation file', async () => {
        const { isMissingInstrumentationModule } = await import(
            '../utils/instrumentation'
        );
        // The user HAS an instrumentation.ts; its own import of 'pino-pretty'
        // is broken. Swallowing this silently disables telemetry.
        const e = Object.assign(
            new Error(
                "Cannot find module 'pino-pretty' imported from /app/instrumentation.ts",
            ),
            { code: 'ERR_MODULE_NOT_FOUND' },
        );
        expect(isMissingInstrumentationModule(e)).toBe(false);
    });

    it('is false for unrelated errors', async () => {
        const { isMissingInstrumentationModule } = await import(
            '../utils/instrumentation'
        );
        expect(
            isMissingInstrumentationModule(new SyntaxError('unexpected token')),
        ).toBe(false);
    });
});
