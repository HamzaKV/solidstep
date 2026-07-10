/**
 * Property key of the JSON-serializable sentinel placed in a node's
 * `loaderData` when its loader fails in isolation (see `server/loader-error.ts`).
 * A plain string message (not an `Error` instance) so it survives the
 * hydration `JSON.stringify`.
 *
 * Isolated from `utils/loader-error.ts` (which pulls in server-only modules)
 * so the client bundle (`client.ts`) can detect the sentinel without
 * importing server code.
 */
export const LOADER_ERROR_KEY = '__loaderError';

/** The serializable shape written into `loaderData` for an isolated failure. */
export type LoaderErrorSentinel = { [LOADER_ERROR_KEY]: string };

/** Whether `data` is an isolated-loader-failure sentinel. */
export const isLoaderErrorSentinel = (
    data: unknown,
): data is LoaderErrorSentinel =>
    typeof data === 'object' &&
    data !== null &&
    typeof (data as Record<string, unknown>)[LOADER_ERROR_KEY] === 'string';
