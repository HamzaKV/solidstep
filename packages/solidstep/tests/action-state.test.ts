import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'solid-js';
import { useActionState } from '../utils/hooks/action-state';

/** Run `fn` inside a reactive root, disposing it once the work settles. */
function withRoot<T>(fn: (dispose: () => void) => Promise<T> | T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        createRoot((dispose) => {
            Promise.resolve(fn(dispose)).then(
                (value) => {
                    dispose();
                    resolve(value);
                },
                (err) => {
                    dispose();
                    reject(err);
                },
            );
        });
    });
}

const fd = () => new FormData();

describe('useActionState', () => {
    it('starts at the initial state with no pending/error', async () => {
        await withRoot(() => {
            const [state, , pending, error] = useActionState(
                async () => ({ n: 1 }),
                { n: 0 },
            );
            expect(state()).toEqual({ n: 0 });
            expect(pending()).toBe(false);
            expect(error()).toBeNull();
        });
    });

    it('runs the action, toggles pending, and updates state', async () => {
        await withRoot(async () => {
            const action = vi.fn(async (prev: { n: number }) => ({
                n: prev.n + 1,
            }));
            const [state, formAction, pending, error] = useActionState(action, {
                n: 0,
            });

            const data = fd();
            formAction(data);
            // pending flips synchronously
            expect(pending()).toBe(true);

            await vi.waitFor(() => expect(pending()).toBe(false));
            expect(action).toHaveBeenCalledWith({ n: 0 }, data);
            expect(state()).toEqual({ n: 1 });
            expect(error()).toBeNull();
        });
    });

    it('captures a thrown Error on the error accessor', async () => {
        await withRoot(async () => {
            const boom = new Error('boom');
            const [, formAction, pending, error] = useActionState(async () => {
                throw boom;
            }, null);

            formAction(fd());
            await vi.waitFor(() => expect(pending()).toBe(false));
            expect(error()).toBe(boom);
        });
    });

    it('wraps a non-Error rejection into an Error', async () => {
        await withRoot(async () => {
            const [, formAction, , error] = useActionState(async () => {
                // Intentionally throw a non-Error to verify it is wrapped.
                throw 'plain string';
            }, null);

            formAction(fd());
            await vi.waitFor(() => expect(error()).not.toBeNull());
            expect(error()).toBeInstanceOf(Error);
            expect(error()!.message).toBe('plain string');
        });
    });

    it('returns a promise that resolves once the action settles, so callers can track its duration', async () => {
        await withRoot(async () => {
            const [, formAction, pending] = useActionState(
                async (prev: number) => prev + 1,
                0,
            );

            const result = formAction(fd());
            expect(result).toBeInstanceOf(Promise);
            expect(pending()).toBe(true);
            await result;
            expect(pending()).toBe(false);
        });
    });

    it('the returned promise resolves (not rejects) even when the action throws', async () => {
        await withRoot(async () => {
            const [, formAction, , error] = useActionState(async () => {
                throw new Error('boom');
            }, null);

            await expect(formAction(fd())).resolves.toBeUndefined();
            expect(error()).not.toBeNull();
        });
    });

    it('ignores a second concurrent call while the first is still pending', async () => {
        await withRoot(async () => {
            const action = vi.fn(async (prev: { n: number }) => ({
                n: prev.n + 1,
            }));
            const [state, formAction, pending] = useActionState(action, {
                n: 0,
            });

            const first = formAction(fd());
            const second = formAction(fd());
            await Promise.all([first, second]);

            expect(action).toHaveBeenCalledTimes(1);
            expect(state()).toEqual({ n: 1 });
            expect(pending()).toBe(false);
        });
    });

    it('clears a previous error on the next submission', async () => {
        await withRoot(async () => {
            let shouldThrow = true;
            const [state, formAction, , error] = useActionState(
                async (prev: number) => {
                    if (shouldThrow) throw new Error('first fails');
                    return prev + 1;
                },
                0,
            );

            formAction(fd());
            await vi.waitFor(() => expect(error()).not.toBeNull());

            shouldThrow = false;
            formAction(fd());
            // error resets synchronously at the start of the next submission
            expect(error()).toBeNull();
            await vi.waitFor(() => expect(state()).toBe(1));
        });
    });
});
