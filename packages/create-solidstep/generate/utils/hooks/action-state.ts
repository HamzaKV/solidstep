import { createSignal } from 'solid-js';

const useActionState = () => {
    const [isPending, setIsPending] = createSignal(false);

    const startTransition = (
        callback: () => void | Promise<void>
    ) => {
        setIsPending(true);
        Promise.resolve(callback())
            .finally(() => {
                setIsPending(false);
            });
    };

    return [isPending, startTransition] as const;
};

export default useActionState;
