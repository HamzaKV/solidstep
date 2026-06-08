import { isServer } from 'solid-js/web';

type LoaderFunction<T> = (request?: Request) => Promise<T>;

type LoaderOptions = {
    type?: 'defer' | 'sequential';
};

/**
 * Define a server-side data loader for a route.
 *
 * Runs only on the server: on the client `defineLoader` returns `null`, so the
 * loader body and its dependencies never reach the browser bundle. On the
 * server it wraps the loader's result as `{ data, type }`, where `type`
 * controls execution strategy relative to sibling loaders (`'sequential'` by
 * default, or `'defer'`).
 *
 * @param loader - Async function receiving the `Request` and returning data.
 * @param options - Loader options (e.g. `type: 'defer' | 'sequential'`).
 * @returns `{ loader, options }` on the server, or `null` on the client.
 *
 * @example
 * ```ts
 * export const loader = defineLoader(async (req) => {
 *   return getUser(req);
 * });
 * ```
 */
export const defineLoader = <T>(
    loader: LoaderFunction<T>,
    options?: LoaderOptions,
) => {
    if (isServer) {
        const fn = async (request?: Request) => {
            const loaderData = await loader(request);
            return {
                data: loaderData,
                type: options?.type || 'sequential',
            };
        };

        return {
            loader: fn,
            options: options || {},
        };
    }

    return null; // Return null if not on the server
};

/**
 * Extract the resolved data type produced by a {@link defineLoader} result.
 *
 * Unwraps the `{ data }` payload, giving components a precise type for the
 * value a loader provides. Resolves to `never` if `T` is not a loader.
 *
 * @typeParam T - The value returned by `defineLoader`.
 */
export type LoaderDataFromFunction<T> = T extends {
    loader: infer L extends (...args: any) => any;
}
    ? Awaited<ReturnType<T['loader']>> extends { data: infer D }
        ? D
        : never
    : never;
