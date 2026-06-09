import { createResource, type Resource } from 'solid-js';

/**
 * Wrap a deferred loader's promise as a Solid resource so a component can read
 * it under `<Suspense>`.
 *
 * - **Server**: pass the in-flight loader promise. Solid suspends on it and
 *   streams the resolved value to the client as a follow-up chunk
 *   (via `renderToStream`).
 * - **Client (hydration)**: pass `undefined`. The resolved value is restored
 *   from the streamed hydration data keyed by the resource's tree position, so
 *   the (never-resolving) fetcher is never actually awaited.
 *
 * The server and client must create the resource at the **same tree position**
 * for hydration to line up — the framework guarantees this by mirroring its
 * compose order on both sides.
 */
export const createDeferredResource = <T>(
    promise?: Promise<T>,
): Resource<T> => {
    const [resource] = createResource<T>(
        () => promise ?? new Promise<T>(() => undefined),
    );
    return resource;
};
