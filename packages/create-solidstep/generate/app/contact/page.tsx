import { Show } from 'solid-js';
import { useActionState } from 'solidstep/hooks/action-state';
import { Form } from 'solidstep/form';
import { sendMessage, type ContactState } from './actions';

export const generateMeta = () => ({
    title: {
        type: 'title',
        attributes: {},
        content: 'Contact · SolidStep',
    },
});

export default function Contact() {
    const [state, formAction, pending] = useActionState<ContactState>(
        sendMessage,
        { sent: false },
    );

    return (
        <section>
            <h1>Contact</h1>
            <Show
                when={state().sent}
                fallback={
                    <Form action={formAction}>
                        <label>
                            Name <input name='name' required />
                        </label>
                        <button type='submit' disabled={pending()}>
                            {pending() ? 'Sending…' : 'Send'}
                        </button>
                    </Form>
                }
            >
                <p>Thanks, {state().name}! Your message was received.</p>
            </Show>
        </section>
    );
}
