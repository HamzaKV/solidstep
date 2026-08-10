// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sharedConfig } from 'solid-js';
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

    it('reacts to the mounted flip during a real SSR->hydrate transition (not just a fresh CSR mount)', async () => {
        // Plain CSR mounts (the test above) never exercise the reactive
        // flip: `sharedConfig.context` is already absent, so `mounted()`
        // starts `true` and the boundary shows children on its first (and
        // only) evaluation regardless of whether that read is tracked. Only
        // a *hydrating* mount — where `mounted()` starts `false` and must
        // later flip via `onMount` — actually exercises the memo's
        // reactivity to that flip, which is what a bare `untrack(() =>
        // mounted() ? ... )` around the read would silently break.
        //
        // Content here is plain text, not JSX elements: solid-js's dev
        // build refuses to clone a *new* element template while
        // `sharedConfig.context` (forced truthy below) marks the tree as
        // hydrating, since a real hydration would adopt existing SSR nodes
        // instead of creating them — an adoption target this plain
        // `render()` (unlike real `hydrate()`) never provides. Text nodes
        // don't go through that template-cloning path, so they sidestep the
        // mismatch while still exercising the signal/memo reactivity this
        // test is actually about.
        (sharedConfig as { context?: unknown }).context = {};
        try {
            const { findByText } = render(() => (
                <ClientOnly fallback='loading'>
                    {() => 'real-content'}
                </ClientOnly>
            ));
            // `mounted()` began `false` (hydrating) and must flip to `true`
            // once `onMount` fires post-mount — if the memo's read of it is
            // untracked, this never resolves (the buggy version stays on
            // "loading" forever, so this throws on `findByText`'s timeout).
            expect(await findByText('real-content')).toBeTruthy();
        } finally {
            (sharedConfig as { context?: unknown }).context = undefined;
        }
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
