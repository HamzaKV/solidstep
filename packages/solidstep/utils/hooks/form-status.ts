import { createContext, useContext, type Accessor } from 'solid-js';

/**
 * Reactive status of the nearest enclosing `<Form>`.
 *
 * @property pending - Whether the form is currently submitting.
 * @property data - The submitted `FormData`, or `null` when idle.
 * @property method - The form's HTTP method.
 * @property action - The form's action URL, or `null`.
 */
export type FormStatusContextValue = {
    pending: Accessor<boolean>;
    data: Accessor<FormData | null>;
    method: Accessor<string>;
    action: Accessor<string | null>;
};

export const FormStatusContext = createContext<FormStatusContextValue>();

/**
 * Read the {@link FormStatusContextValue} of the nearest enclosing `<Form>`.
 *
 * Must be called from a component rendered inside a SolidStep `<Form>`. When
 * used outside any `<Form>`, it returns inert defaults (`pending: false`,
 * `data: null`, `method: 'GET'`, `action: null`) rather than throwing.
 *
 * @returns The current form status accessors.
 */
const useFormStatus = (): FormStatusContextValue => {
    const ctx = useContext(FormStatusContext);
    if (!ctx) {
        return {
            pending: () => false,
            data: () => null,
            method: () => 'GET',
            action: () => null,
        };
    }
    return ctx;
};

export { useFormStatus };
export default useFormStatus;
