import fileRoutes from 'vinxi/routes';
import {
    buildManifest,
    matchInManifest,
    getNotFoundInManifest,
    type ClientFileRoute,
    type ClientPageHandler,
} from './client-manifest-core';

/**
 * Client route manifest. A thin wrapper over `client-manifest-core` (the pure,
 * unit-tested logic) that feeds it the real client `fileRoutes` and memoizes the
 * built trie. The CLIENT `fileRoutes` expose only `$component` — no
 * `$loader`/`$generateMeta`/`$handler` (see `ClientRouter` in `utils/router.ts`).
 * Loaders never run on the client; a soft navigation fetches resolved loader
 * data from the `/__solidstep_route` endpoint instead.
 */

export type { ClientImport, ClientPageHandler } from './client-manifest-core';

let manifest: ReturnType<typeof buildManifest> | null = null;
const getManifestTrie = () => {
    if (!manifest) {
        manifest = buildManifest(fileRoutes as unknown as ClientFileRoute[]);
    }
    return manifest;
};

/**
 * Match a pathname against the client route trie. Returns the matched
 * {@link ClientPageHandler} and params, or `null` if no page route matches.
 */
export const matchClientRoute = (
    pathname: string,
): {
    handler: ClientPageHandler;
    params: Record<string, string | string[]>;
} | null => matchInManifest(getManifestTrie(), pathname);

/** Find the root not-found page handler, if one is configured. */
export const getNotFoundHandler = ():
    | ClientPageHandler['notFoundPage']
    | undefined => getNotFoundInManifest(getManifestTrie());
