import { getCachedLoaderData } from './loader-cache.js';
import { logger } from './logger.js';
import { RedirectError } from './redirect.js';
import {
    LOADER_ERROR_KEY,
    type LoaderErrorSentinel,
} from './loader-error-sentinel.js';

export { LOADER_ERROR_KEY, type LoaderErrorSentinel };

/**
 * Run a single sequential loader with per-node error isolation.
 *
 * On success, returns the loader's data. On failure:
 * - the **page** loader re-throws, so the route-level `error.tsx` renders
 *   (preserving the whole-page error contract for primary content);
 * - a **layout/group** loader resolves to a serializable error sentinel
 *   (`{ [LOADER_ERROR_KEY]: message }`) so sibling content still renders.
 *
 * @param loaderFn - The resolved `{ loader, options }` wrapper.
 * @param manifestPath - The node's manifest path (cache key component).
 * @param req - The incoming request.
 * @param isPageLoader - Whether this is the page loader (vs a layout/group).
 * @param invocation - Request-scoped `locals` + abort `signal` to thread in.
 */
export const runSequentialLoader = async (
    loaderFn: Parameters<typeof getCachedLoaderData>[0],
    manifestPath: string,
    req: Request,
    isPageLoader: boolean,
    invocation?: Parameters<typeof getCachedLoaderData>[3],
): Promise<unknown> => {
    try {
        return await getCachedLoaderData(
            loaderFn,
            manifestPath,
            req,
            invocation,
        );
    } catch (err) {
        if (isPageLoader) throw err;
        // A redirect is control flow, not a data failure: layout loaders that
        // redirect (e.g. auth gating) must abort the whole render, never
        // degrade into a sentinel that lets the gated tree render.
        if (
            err instanceof RedirectError ||
            (err instanceof Error && err.name === 'RedirectError')
        ) {
            throw err;
        }
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(
            { manifestPath, err: message },
            'Layout/group loader failed; rendering with error sentinel',
        );
        // `logger` is silent by default (see `defineConfig`'s `logger` option
        // and `utils/pino.ts`) - a layout/group loader degrading to the error
        // sentinel is a real, already-caught failure an author needs to know
        // about, not routine trace noise, so it must not depend on opting
        // into pino logging to be visible at all.
        console.error(
            `[solidstep] layout/group loader at ${manifestPath} failed; rendering with error sentinel:`,
            message,
        );
        return {
            [LOADER_ERROR_KEY]: message,
        };
    }
};
