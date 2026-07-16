// @refresh skip
import type { Component, ComponentProps, JSX, Setter } from 'solid-js';
import { createMemo, createSignal, sharedConfig, untrack } from 'solid-js';
import { isServer } from 'solid-js/web';
import { useHydrationMounted } from './internal/hydration-mounted.js';

const load = <T>(
    fn: () => Promise<{
        default: T;
    }>,
    setComp: Setter<T>,
) => {
    fn().then((m) => setComp(() => m.default));
};

/**
 * Wrap a component so it only renders on the client.
 *
 * During SSR (and until the component has mounted on the client) the optional
 * `fallback` is rendered instead, avoiding hydration mismatches for code that
 * must run in the browser. Once mounted, the wrapped component renders
 * normally.
 *
 * @param component - The component to render client-side only.
 * @param options - Optional `fallback` element shown on the server / before
 *   mount.
 * @returns A component with the same props as `component`.
 *
 * @example
 * ```tsx
 * const Chart = clientOnly(() => import('./Chart'), {
 *   fallback: <Spinner />,
 * });
 * ```
 */
const clientOnly = <T extends Component<any>>(
    component: T,
    options?: { fallback?: JSX.Element },
) => {
    if (isServer) return () => options?.fallback ?? null;

    const [comp, setComp] = createSignal<T>();
    load(async () => ({ default: component }), setComp);
    return (props: ComponentProps<T>) => {
        let Comp: T | undefined;
        if ((Comp = comp()) && !sharedConfig.context) return Comp(props);
        const mounted = useHydrationMounted();
        return createMemo(() => {
            Comp = comp();
            const m = mounted();
            return untrack(() => (Comp && m ? Comp(props) : options?.fallback));
        }) as unknown as JSX.Element;
    };
};

export default clientOnly;
