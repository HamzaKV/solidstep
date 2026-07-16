// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@solidjs/testing-library';
import { ClientOnly } from '../utils/components/client-only';

// See tests/client-only.test.tsx for why the client branch is imported
// statically (shares this file's single Solid instance with `render`) while
// the server branch re-imports the module with `isServer` mocked true.

describe('ClientOnly (client)', () => {
    it('renders the children function after mount', async () => {
        const { findByText } = render(() => (
            <ClientOnly fallback={<span>loading</span>}>
                {() => <div>real-content</div>}
            </ClientOnly>
        ));
        expect(await findByText('real-content')).toBeTruthy();
    });
});

describe('ClientOnly (server)', () => {
    beforeEach(() => vi.resetModules());
    afterEach(() => vi.doUnmock('solid-js/web'));

    it('renders the provided fallback instead of calling children', async () => {
        vi.doMock('solid-js/web', async (importOriginal) => ({
            ...(await importOriginal<typeof import('solid-js/web')>()),
            isServer: true,
        }));
        const { ClientOnly: ServerClientOnly } = await import(
            '../utils/components/client-only'
        );
        const childrenFn = vi.fn(() => <div>real-content</div>);
        const fallback = <span>fallback-content</span>;
        const result = ServerClientOnly({ fallback, children: childrenFn });
        expect(result).toBe(fallback);
        expect(childrenFn).not.toHaveBeenCalled();
    });

    it('renders null when no fallback is provided', async () => {
        vi.doMock('solid-js/web', async (importOriginal) => ({
            ...(await importOriginal<typeof import('solid-js/web')>()),
            isServer: true,
        }));
        const { ClientOnly: ServerClientOnly } = await import(
            '../utils/components/client-only'
        );
        const result = ServerClientOnly({
            children: () => <div>real-content</div>,
        });
        expect(result).toBeNull();
    });
});
