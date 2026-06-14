// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@solidjs/testing-library';
import clientOnly from '../utils/client-only';

// `clientOnly` defers a component to the browser, showing a fallback during SSR
// and until mount. The client branch runs under jsdom's default
// `isServer === false` and is imported statically so it shares a single Solid
// instance with `render` (a re-imported copy would be a second Solid instance
// and its reactivity wouldn't drive the rendered tree). The server branch
// overrides only `isServer` via a re-import, spreading the real module so the
// JSX runtime in this .tsx file keeps working; it never renders, so the
// single-instance constraint doesn't apply.

describe('clientOnly (client)', () => {
    it('renders the wrapped component after mount', async () => {
        const Real = () => <div>real-content</div>;
        const Wrapped = clientOnly(Real, { fallback: <span>loading</span> });
        const { findByText } = render(() => <Wrapped />);
        expect(await findByText('real-content')).toBeTruthy();
    });
});

describe('clientOnly (server)', () => {
    beforeEach(() => vi.resetModules());
    afterEach(() => vi.doUnmock('solid-js/web'));

    it('renders the provided fallback instead of the component', async () => {
        vi.doMock('solid-js/web', async (importOriginal) => ({
            ...(await importOriginal<typeof import('solid-js/web')>()),
            isServer: true,
        }));
        const { default: serverClientOnly } = await import(
            '../utils/client-only'
        );
        const fallback = <span>fallback-content</span>;
        const Wrapped = serverClientOnly(() => <div>real-content</div>, {
            fallback,
        });
        // On the server the wrapper is `() => options?.fallback ?? null`.
        expect((Wrapped as () => unknown)()).toBe(fallback);
    });

    it('renders null when no fallback is provided', async () => {
        vi.doMock('solid-js/web', async (importOriginal) => ({
            ...(await importOriginal<typeof import('solid-js/web')>()),
            isServer: true,
        }));
        const { default: serverClientOnly } = await import(
            '../utils/client-only'
        );
        const Wrapped = serverClientOnly(() => <div>real-content</div>);
        expect((Wrapped as () => unknown)()).toBeNull();
    });
});
