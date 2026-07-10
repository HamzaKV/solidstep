// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';

const prefetchRoute = vi.fn();
vi.mock('../utils/router-context', () => ({
    navigate: vi.fn(async () => {}),
    prefetchRoute: (...a: unknown[]) => prefetchRoute(...a),
}));

import { Link } from '../utils/components/link';

describe('<Link> prefetch reactivity', () => {
    beforeEach(() => {
        prefetchRoute.mockClear();
    });

    it('attaches the hover handler when prefetch switches TO "hover" after mount (not attached at setup)', () => {
        // Starting as `false` means no onMouseEnter handler is wired up at
        // setup time -- this specifically catches the case a one-time,
        // non-reactive read of `prefetch` would miss.
        const [prefetch, setPrefetch] = createSignal<
            boolean | 'hover' | 'viewport'
        >(false);
        const { container } = render(() => (
            <Link href='/about' prefetch={prefetch()}>
                About
            </Link>
        ));
        const anchor = container.querySelector('a')!;

        fireEvent.mouseEnter(anchor);
        expect(prefetchRoute).not.toHaveBeenCalled();

        setPrefetch('hover');
        fireEvent.mouseEnter(anchor);
        expect(prefetchRoute).toHaveBeenCalledTimes(1);
    });

    it('stops prefetching on hover when the prop switches away from "hover"', () => {
        const [prefetch, setPrefetch] = createSignal<
            boolean | 'hover' | 'viewport'
        >('hover');
        const { container } = render(() => (
            <Link href='/about' prefetch={prefetch()}>
                About
            </Link>
        ));
        const anchor = container.querySelector('a')!;

        fireEvent.mouseEnter(anchor);
        expect(prefetchRoute).toHaveBeenCalledTimes(1);

        setPrefetch(false);
        prefetchRoute.mockClear();
        fireEvent.mouseEnter(anchor);
        expect(prefetchRoute).not.toHaveBeenCalled();
    });
});

describe('<Link> prefetch="viewport" reactivity', () => {
    class MockIntersectionObserver {
        callback: IntersectionObserverCallback;
        observed = new Set<Element>();
        constructor(callback: IntersectionObserverCallback) {
            this.callback = callback;
        }
        observe(el: Element) {
            this.observed.add(el);
        }
        unobserve(el: Element) {
            this.observed.delete(el);
        }
        disconnect() {}
        trigger(el: Element) {
            this.callback(
                [
                    {
                        isIntersecting: true,
                        target: el,
                    } as IntersectionObserverEntry,
                ],
                this as unknown as IntersectionObserver,
            );
        }
    }

    let observers: MockIntersectionObserver[];

    beforeEach(() => {
        prefetchRoute.mockClear();
        observers = [];
        vi.stubGlobal(
            'IntersectionObserver',
            class extends MockIntersectionObserver {
                constructor(cb: IntersectionObserverCallback) {
                    super(cb);
                    observers.push(this);
                }
            },
        );
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('starts observing when prefetch switches to "viewport" after mount', () => {
        const [prefetch, setPrefetch] = createSignal<
            boolean | 'hover' | 'viewport'
        >('hover');
        const { container } = render(() => (
            <Link href='/about' prefetch={prefetch()}>
                About
            </Link>
        ));
        const anchor = container.querySelector('a')!;

        setPrefetch('viewport');
        const observer = observers.at(-1);
        expect(observer?.observed.has(anchor)).toBe(true);

        observer!.trigger(anchor);
        expect(prefetchRoute).toHaveBeenCalledTimes(1);
    });
});
