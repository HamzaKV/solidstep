import { getCachedLoaderData } from './loader-cache';
import { logger } from './logger';

/**
 * Property key of the JSON-serializable sentinel placed in a node's
 * `loaderData` when its loader fails in isolation. A plain string message (not
 * an `Error` instance) so it survives the hydration `JSON.stringify`.
 */
export const LOADER_ERROR_KEY = '__loaderError';

/** The serializable shape written into `loaderData` for an isolated failure. */
export type LoaderErrorSentinel = { [LOADER_ERROR_KEY]: string };

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
 */
export const runSequentialLoader = async (
    loaderFn: Parameters<typeof getCachedLoaderData>[0],
    manifestPath: string,
    req: Request,
    isPageLoader: boolean,
): Promise<unknown> => {
    try {
        return await getCachedLoaderData(loaderFn, manifestPath, req);
    } catch (err) {
        if (isPageLoader) throw err;
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(
            { manifestPath, err: message },
            'Layout/group loader failed; rendering with error sentinel',
        );
        return {
            [LOADER_ERROR_KEY]: message,
        };
    }
};
