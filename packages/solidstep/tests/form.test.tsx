// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render } from '@solidjs/testing-library';
import { Form, type ServerActionFn } from '../utils/components/form';
import { useFormStatus } from '../utils/hooks/form-status';

const withUrl = (url: string): ServerActionFn => {
    const fn: ServerActionFn = vi.fn(async () => {});
    fn.url = url;
    return fn;
};

describe('<Form>', () => {
    it('renders a POST form with no action attribute for a plain formAction', () => {
        const { container } = render(() => (
            <Form action={vi.fn()}>
                <input name='x' value='1' />
            </Form>
        ));
        const form = container.querySelector('form')!;
        expect(form.method).toBe('post');
        expect(form.getAttribute('action')).toBeNull();
    });

    it('emits the server action URL as the action attribute (no-JS fallback)', () => {
        const { container } = render(() => (
            <Form action={withUrl('/_server?id=abc')}>
                <input name='x' />
            </Form>
        ));
        const form = container.querySelector('form')!;
        expect(form.getAttribute('action')).toBe('/_server?id=abc');
    });

    it('treats an empty action url as no action attribute', () => {
        const { container } = render(() => (
            <Form action={withUrl('')}>
                <input name='x' />
            </Form>
        ));
        const form = container.querySelector('form')!;
        expect(form.getAttribute('action')).toBeNull();
    });

    it('calls the action with the form FormData on submit', async () => {
        const action = vi.fn(async () => {});
        const { container } = render(() => (
            <Form action={action}>
                <input name='name' value='ada' />
            </Form>
        ));
        const form = container.querySelector('form')!;
        form.requestSubmit();
        await vi.waitFor(() => expect(action).toHaveBeenCalledTimes(1));
        const data = action.mock.calls[0][0] as FormData;
        expect(data).toBeInstanceOf(FormData);
        expect(data.get('name')).toBe('ada');
    });

    it('uses a submitter __serverAction override when present', async () => {
        const formAction = vi.fn(async () => {});
        const overrideAction = vi.fn(async () => {});
        const { container } = render(() => (
            <Form action={formAction}>
                <button type='submit'>go</button>
            </Form>
        ));
        const form = container.querySelector('form')!;
        const button = container.querySelector('button')!;
        (button as unknown as { __serverAction: unknown }).__serverAction =
            overrideAction;
        form.requestSubmit(button);
        await vi.waitFor(() => expect(overrideAction).toHaveBeenCalledTimes(1));
        expect(formAction).not.toHaveBeenCalled();
    });

    it('exposes the form status (POST method) to nested useFormStatus consumers', () => {
        const StatusProbe = () => {
            const status = useFormStatus();
            return (
                <span data-testid='status'>
                    {status.method()}:{String(status.pending())}:
                    {String(status.action())}:{String(status.data())}
                </span>
            );
        };
        const { container } = render(() => (
            <Form action={vi.fn()}>
                <StatusProbe />
            </Form>
        ));
        expect(
            container.querySelector('[data-testid="status"]')!.textContent,
        ).toBe('POST:false:null:null');
    });

    it('catches a throwing action without rejecting the submit handler', async () => {
        const action = vi.fn(async () => {
            throw new Error('nope');
        });
        const errSpy = vi
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        const { container } = render(() => (
            <Form action={action}>
                <input name='x' />
            </Form>
        ));
        container.querySelector('form')!.requestSubmit();
        await vi.waitFor(() => expect(action).toHaveBeenCalled());
        await vi.waitFor(() => expect(errSpy).toHaveBeenCalled());
        errSpy.mockRestore();
    });

    it('ignores a second submit while the first is still pending', async () => {
        let resolveAction: () => void;
        const action = vi.fn(
            () =>
                new Promise<void>((r) => {
                    resolveAction = r;
                }),
        );
        const { container } = render(() => (
            <Form action={action}>
                <input name='x' />
            </Form>
        ));
        const form = container.querySelector('form')!;
        form.requestSubmit();
        form.requestSubmit();
        form.requestSubmit();
        await vi.waitFor(() => expect(action).toHaveBeenCalled());
        // A fast double/triple-click must not fire the server action more
        // than once while the first submission is still in flight.
        expect(action).toHaveBeenCalledTimes(1);
        resolveAction!();
    });

    it('calls onError instead of console.error when the action throws and onError is provided', async () => {
        const boom = new Error('nope');
        const action = vi.fn(async () => {
            throw boom;
        });
        const onError = vi.fn();
        const errSpy = vi
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        const { container } = render(() => (
            <Form action={action} onError={onError}>
                <input name='x' />
            </Form>
        ));
        container.querySelector('form')!.requestSubmit();
        await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(boom));
        expect(errSpy).not.toHaveBeenCalled();
        errSpy.mockRestore();
    });
});
