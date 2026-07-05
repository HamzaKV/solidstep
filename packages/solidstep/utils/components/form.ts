import {
    createComponent,
    createSignal,
    splitProps,
    mergeProps,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
    FormStatusContext,
    type FormStatusContextValue,
} from '../hooks/form-status.js';

/**
 * A server action function created by the `'use server'` directive.
 * Has a `.url` property pointing to the `/_server` endpoint.
 */
export type ServerActionFn = {
    (...args: any[]): any;
    url?: string;
};

export type FormProps = {
    /** Server action or wrapped formAction from useActionState */
    action: ServerActionFn | ((formData: FormData) => void);
    /** Form content */
    children?: any;
    /** Additional HTML form attributes are spread onto the <form> element */
    [key: string]: any;
};

/**
 * Enhanced `<form>` component that submits via server actions.
 *
 * - Intercepts form submission and calls the server action with `FormData`
 * - Provides `FormStatusContext` for nested `useFormStatus()` calls
 * - Supports progressive enhancement: when JS is disabled, the form
 *   submits natively to the server action URL (if the action has one)
 * - Supports `formAction` overrides on submitter elements (buttons)
 *
 * Rendered with Solid's isomorphic `Dynamic`, so it server-renders and hydrates
 * correctly (no client-only primitives are evaluated on the server).
 *
 * @example
 * ```tsx
 * import { Form } from 'solidstep/form';
 * import { createInvoice } from './actions';
 *
 * export default function Page() {
 *   return (
 *     <Form action={createInvoice}>
 *       <input name="amount" />
 *       <button type="submit">Create</button>
 *     </Form>
 *   );
 * }
 * ```
 */
const Form = (props: FormProps) => {
    const [local, others] = splitProps(props, ['action', 'children']);
    const [pending, setPending] = createSignal(false);
    const [formData, setFormData] = createSignal<FormData | null>(null);

    const actionUrl = (): string | null => {
        const action = local.action;
        if (typeof action === 'function' && 'url' in action) {
            return (action as ServerActionFn).url || null;
        }
        return null;
    };

    const contextValue: FormStatusContextValue = {
        pending,
        data: formData,
        method: () => 'POST',
        action: actionUrl,
    };

    const handleSubmit = async (e: Event) => {
        e.preventDefault();

        const form = e.currentTarget as HTMLFormElement;
        const submitter = (e as SubmitEvent).submitter;
        const data = new FormData(form, submitter);

        // Check for formAction override on submitter element
        let action: ServerActionFn | ((formData: FormData) => void) =
            local.action;
        if (submitter && '__serverAction' in submitter) {
            action = (submitter as any).__serverAction;
        }

        setFormData(data);
        setPending(true);

        try {
            await action(data);
        } catch (error) {
            console.error('Form action error:', error);
        } finally {
            setPending(false);
            setFormData(null);
        }
    };

    // `Dynamic` renders a real <form> on both server and client. The `onSubmit`
    // handler is attached only on the client (ignored during SSR); `method` and
    // `action` are emitted as attributes for the no-JS progressive-enhancement
    // fallback. Remaining props (class, id, data-*, ...) are spread through.
    const formProps: any = mergeProps(
        {
            component: 'form',
            method: 'POST',
            onSubmit: handleSubmit,
            get action() {
                return actionUrl() ?? undefined;
            },
        },
        others,
        {
            get children() {
                return local.children;
            },
        },
    );

    return createComponent(FormStatusContext.Provider, {
        value: contextValue,
        get children() {
            return createComponent(Dynamic, formProps);
        },
    });
};

export { Form };
export default Form;
