import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    registerShutdownHandler,
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
