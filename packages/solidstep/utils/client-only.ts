// @refresh skip
import type { Component, ComponentProps, JSX, Setter } from 'solid-js';
import { createMemo, createSignal, onMount, sharedConfig, untrack } from 'solid-js';
import { isServer } from 'solid-js/web';

const load = <T>(
    fn: () => Promise<{
        default: T;
    }>,
    setComp: Setter<T>,
) => {
    fn().then(m => setComp(() => m.default));
};

const clientOnly = <T extends Component<any>>(
    component: T,
    options?: { fallback?: JSX.Element; }
) => {
    if (isServer) return () => (options?.fallback) ?? null;

    const [comp, setComp] = createSignal<T>();
    load(async () => ({ default: component }), setComp);
    return (props: ComponentProps<T>) => {
        let Comp: T | undefined;
        let m: boolean;
        if ((Comp = comp()) && !sharedConfig.context) return Comp(props);
        const [mounted, setMounted] = createSignal(!sharedConfig.context);
        onMount(() => setMounted(true));
        return createMemo(
            () => (
                // biome-ignore lint/style/noCommaOperator: <explanation>
                (Comp = comp()), (m = mounted()), untrack(() => (Comp && m ? Comp(props) : options?.fallback))
            ),
        ) as unknown as JSX.Element;
    };
};

export default clientOnly;
