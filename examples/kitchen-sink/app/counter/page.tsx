import { useActionState } from 'solidstep/hooks/action-state';
import { Form } from 'solidstep/form';
import { adjust } from './actions';

export const generateMeta = () => ({
    title: {
        type: 'title',
        attributes: {},
        content: 'Counter — Kitchen Sink',
    },
});

const CounterPage = () => {
    const [state, formAction, pending, error] = useActionState(adjust, { count: 0 });

    return (
        <section>
            <h1 data-testid="heading">Counter</h1>
            <p data-testid="count">{state().count}</p>
            <Form action={formAction}>
                <input data-testid="step" name="step" value="1" />
                <button data-testid="submit" type="submit" disabled={pending()}>
                    {pending() ? 'Working…' : 'Apply'}
                </button>
            </Form>
            {error() && (
                <p role="alert" data-testid="error">
                    {error()!.message}
                </p>
            )}
        </section>
    );
};

export default CounterPage;
