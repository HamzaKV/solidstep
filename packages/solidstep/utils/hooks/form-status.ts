import { createContext, useContext, type Accessor } from 'solid-js';

export type FormStatusContextValue = {
    pending: Accessor<boolean>;
    data: Accessor<FormData | null>;
    method: Accessor<string>;
    action: Accessor<string | null>;
};

export const FormStatusContext = createContext<FormStatusContextValue>();

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

export default useFormStatus;
