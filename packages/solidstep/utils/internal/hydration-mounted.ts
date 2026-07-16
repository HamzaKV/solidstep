import { createSignal, onMount, sharedConfig } from 'solid-js';

/**
 * Tracks whether the client has finished hydrating (or, when there was
 * nothing to hydrate, whether the component has mounted at all).
 *
 * Shared by both `clientOnly` (the lazy-component HOC, `../client-only.js`)
 * and `ClientOnly` (the JSX boundary, `./components/client-only.js`) so the
 * mount-detection logic — the `sharedConfig.context` check plus the
 * `onMount` flip — lives in exactly one place.
 *
 * @returns A reactive accessor: `false` during SSR and until the client has
 *   mounted, `true` afterward.
 */
export const useHydrationMounted = (): (() => boolean) => {
    const [mounted, setMounted] = createSignal(!sharedConfig.context);
    onMount(() => setMounted(true));
    return mounted;
};

export default useHydrationMounted;
