import { useActionState } from 'solidstep/hooks/action-state';
import { Form } from 'solidstep/form';
import { authenticate } from './actions';

export const generateMeta = () => ({
    title: {
        type: 'title',
        attributes: {},
        content: 'Login — Kitchen Sink',
    },
});

const LoginPage = () => {
    const [state, formAction, pending] = useActionState(authenticate, {});

    return (
        <section>
            <h1 data-testid='heading'>Login</h1>
            <Form action={formAction}>
                <input
                    data-testid='username'
                    name='username'
                    placeholder='username'
                />
                <input
                    data-testid='password'
                    name='password'
                    type='password'
                    placeholder='password'
                />
                <button data-testid='submit' type='submit' disabled={pending()}>
                    {pending() ? 'Signing in…' : 'Sign in'}
                </button>
            </Form>
            {state().ok && <p data-testid='status'>Signed in</p>}
            {state().error && (
                <p role='alert' data-testid='error'>
                    {state().error}
                </p>
            )}
        </section>
    );
};

export default LoginPage;
