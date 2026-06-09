import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'solid-js';
import { createDeferredResource } from '../utils/deferred';

describe('createDeferredResource', () => {
    it('creates a pending resource when no promise is given (client hydration path)', () => {
        createRoot((dispose) => {
            const resource = createDeferredResource<number>();
            expect(resource.loading).toBe(true);
            expect(resource()).toBeUndefined();
            dispose();
        });
    });

    it('resolves to the value of the provided promise (server path)', async () => {
        await new Promise<void>((resolve, reject) => {
            createRoot(async (dispose) => {
                try {
                    const resource = createDeferredResource(
                        Promise.resolve({ msg: 'ok' }),
                    );
                    expect(resource.loading).toBe(true);
                    await vi.waitFor(() =>
                        expect(resource()).toEqual({ msg: 'ok' }),
                    );
                } finally {
                    dispose();
                    resolve();
                }
            }).catch(reject);
        });
    });
});
