// @refresh skip
import { type JSX, createMemo, untrack } from 'solid-js';
import { isServer } from 'solid-js/web';
import { useHydrationMounted } from '../internal/hydration-mounted.js';

export type ClientOnlyProps = {
    /**
     * Evaluated lazily — only once this boundary has mounted client-side.
     * Never called during SSR or the hydration walk itself. A function
     * (not a plain `JSX.Element`) so nothing inside is constructed before
     * the boundary decides to render it.
     */
    children: () => JSX.Element;
    /** Shown during SSR and until the client mounts. Defaults to nothing. */
    fallback?: JSX.Element;
};

/**
 * Render `children` only after the client has mounted — never during SSR,
 * never during hydration.
 *
 * Use this to wrap already-open, conditionally-rendered JSX (a dialog's
 * content, a dropdown's menu, a portal) whose visibility is driven by a
 * signal, instead of gating the subtree with a top-level `<Show>`. A
 * `<Show when={signal()}>` wrapping a whole interactive subtree can throw a
 * hydration-key mismatch when the server and client's initial comment-marker
 * counts disagree (see the Troubleshooting guide) — `ClientOnly` sidesteps
 * that entirely by never putting the content through the SSR/hydration walk
 * in the first place.
 *
 * @example
 * ```tsx
 * import { ClientOnly } from 'solidstep/client-only';
 *
 * <ClientOnly fallback={null}>
 *   {() => <HeavyMap markers={markers()} />}
 * </ClientOnly>
 * ```
 */
export const ClientOnly = (props: ClientOnlyProps): JSX.Element => {
    if (isServer) return props.fallback ?? null;

    const mounted = useHydrationMounted();

    return createMemo(() =>
        untrack(() =>
            mounted() ? props.children() : (props.fallback ?? null),
        ),
    ) as unknown as JSX.Element;
};

export default ClientOnly;
