import { createSignal, type Accessor } from 'solid-js';

export type UseActionStateReturn<T> = [
    state: Accessor<T>,
    formAction: (formData: FormData) => Promise<void>,
    pending: Accessor<boolean>,
    error: Accessor<Error | null>,
];

/**
 * Wraps a server action for use with `<Form>`.
 *
 * The server action receives `(prevState, formData)` and returns the new state.
 * The returned `formAction` can be passed directly to `<Form action={formAction}>`.
 *
 * @param action - Server action: `(prevState: T, formData: FormData) => Promise<T>`
 * @param initialState - Initial state value before any submission.
 * @returns `[state, formAction, pending, error]`
 */
const useActionState = <T>(
    action: (prevState: T, formData: FormData) => Promise<T>,
    initialState: T,
): UseActionStateReturn<T> => {
    const [state, setState] = createSignal<T>(initialState);
    const [isPending, setIsPending] = createSignal(false);
    const [error, setError] = createSignal<Error | null>(null);

    const formAction = (formData: FormData): Promise<void> => {
        setIsPending(true);
        setError(null);
        return Promise.resolve(action(state(), formData))
            .then((result) => {
                setState(() => result);
            })
            .catch((err) => {
                setError(err instanceof Error ? err : new Error(String(err)));
            })
            .finally(() => {
                setIsPending(false);
            });
    };

    return [state, formAction, isPending, error];
};

export { useActionState };
export default useActionState;
