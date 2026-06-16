import { logger } from './logger';

/**
 * Thrown when a loader exceeds its configured timeout. It flows through the
 * normal loader error isolation (`utils/loader-error`): a page loader renders
 * `error.tsx`, a layout/group loader yields the serializable error sentinel.
 */
export class LoaderTimeoutError extends Error {
    constructor(public readonly timeoutMs: number) {
        super(`Loader exceeded its ${timeoutMs}ms timeout`);
        this.name = 'LoaderTimeoutError';
    }
}

/**
 * Resolve the effective timeout (ms) for a loader from its per-loader `timeout`
 * option and the global `defineConfig({ loaderTimeout })` default.
 *
 * - a per-loader `timeout` wins (including `0`, which disables the timeout);
 * - otherwise the global default applies;
 * - a non-positive or absent result means "no timeout" (`undefined`).
 */
export const resolveLoaderTimeout = (
    optionTimeout?: number,
): number | undefined => {
    const globalDefault = (
        globalThis as { __SOLIDSTEP_CONFIG__?: { loaderTimeout?: number } }
    ).__SOLIDSTEP_CONFIG__?.loaderTimeout;
    const raw = optionTimeout ?? globalDefault;
    return typeof raw === 'number' && raw > 0 ? raw : undefined;
};

/**
 * Run `work` under a combined abort signal: the optional `parentSignal` (client
 * disconnect) plus, when `timeoutMs` is positive, a timeout. `work` receives the
 * combined signal so it can forward it to `fetch`/DB calls and cancel real work.
 *
 * Rejects with {@link LoaderTimeoutError} when the timeout fires, or with the
 * parent's abort reason when the parent aborts first; otherwise settles with
 * `work`'s own result. `timeoutMs` is expected to be positive or omitted (see
 * {@link resolveLoaderTimeout}); a falsy value runs `work` under `parentSignal`
 * alone.
 */
export const runWithLoaderTimeout = <T>(
    work: (signal: AbortSignal | undefined) => Promise<T>,
    opts: { timeoutMs?: number; parentSignal?: AbortSignal },
): Promise<T> => {
    const { timeoutMs, parentSignal } = opts;
    if (!timeoutMs) {
        return work(parentSignal);
    }
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = parentSignal
        ? AbortSignal.any([parentSignal, timeoutSignal])
        : timeoutSignal;
    return new Promise<T>((resolve, reject) => {
        const onAbort = () => {
            // Distinguish our timeout from a parent (client-disconnect) abort so
            // the error surfaces meaningfully through loader-error isolation.
            if (timeoutSignal.aborted) {
                logger.warn({ timeoutMs }, 'Loader timed out');
                reject(new LoaderTimeoutError(timeoutMs));
            } else {
                reject(signal.reason);
            }
        };
        signal.addEventListener('abort', onAbort, { once: true });
        // A Promise ignores settle calls after the first, so the abort listener
        // and `work` racing to settle is safe; `finally` just unbinds the listener
        // once `work` wins so a later timeout can't fire a stray rejection.
        work(signal)
            .then(resolve, reject)
            .finally(() => signal.removeEventListener('abort', onAbort));
    });
};
