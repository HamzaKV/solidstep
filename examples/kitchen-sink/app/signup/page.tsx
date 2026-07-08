import { For, Show } from 'solid-js';
import { useActionState } from 'solidstep/hooks/action-state';
import { Form } from 'solidstep/form';
import { isValidationError } from 'solidstep/utils/action-schema';
import { signup, type SignupState } from './actions';

export const generateMeta = () => ({
    title: {
        type: 'title',
        attributes: {},
        content: 'Sign up — Kitchen Sink',
    },
});

const SignupPage = () => {
    const [state, formAction, pending, error] = useActionState<SignupState>(
        signup,
        {},
    );

    return (
        <section>
            <h1 data-testid='heading'>Sign up</h1>
            <Form action={formAction}>
                <input data-testid='signup-name' name='name' />
                <input data-testid='signup-email' name='email' />
                <button
                    data-testid='signup-submit'
                    type='submit'
                    disabled={pending()}
                >
                    {pending() ? 'Working…' : 'Sign up'}
                </button>
            </Form>
            <Show when={state().ok}>
                <p data-testid='signup-success'>Welcome, {state().name}!</p>
            </Show>
            <Show when={error() && isValidationError(error())}>
                <ul data-testid='signup-errors'>
                    <For
                        each={
                            (
                                error() as unknown as {
                                    issues: { message: string }[];
                                }
                            ).issues
                        }
                    >
                        {(issue) => <li>{issue.message}</li>}
                    </For>
                </ul>
            </Show>
        </section>
    );
};

export default SignupPage;
