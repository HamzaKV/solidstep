import {
    type JSX,
    createComponent,
    splitProps,
    mergeProps,
    onMount,
    onCleanup,
} from 'solid-js';
import { Dynamic, isServer } from 'solid-js/web';
import { navigate, prefetchRoute, type Href } from '../router-context.js';

/**
 * Props for {@link Link}. Extends the native anchor attributes with router
 * options. Always renders a real `<a href>` (progressive enhancement): when JS
 * is unavailable or the target is external, it behaves as a normal anchor.
 */
export type LinkProps = Omit<
    JSX.AnchorHTMLAttributes<HTMLAnchorElement>,
    'href'
> & {
    /** Target route. Type-checked against the app's routes when typed routes are generated. */
    href: Href;
    /** Replace the current history entry instead of pushing a new one. */
    replace?: boolean;
    /**
     * When to prefetch the target's data + modules: `'hover'` (default),
     * `'viewport'` (when scrolled into view), `true` (eagerly on mount), or
     * `false` (never).
     */
    prefetch?: boolean | 'hover' | 'viewport';
    /** Scroll to top after navigating (default `true`; ignored for hash links). */
    scroll?: boolean;
    /**
     * Wrap the navigation commit in `document.startViewTransition()`. Ignored
     * when the API is unsupported or `prefers-reduced-motion: reduce` is set.
     */
    viewTransition?: boolean;
};

/** Whether a click should be handled by the router rather than the browser. */
const shouldIntercept = (
    e: MouseEvent,
    anchor: HTMLAnchorElement,
    target: string | undefined,
): boolean => {
    if (e.defaultPrevented) return false;
    if (e.button !== 0) return false; // left click only
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
    if (target && target !== '_self') return false;
    if (anchor.hasAttribute('download')) return false;
    const rel = anchor.getAttribute('rel');
    if (rel?.split(/\s+/).includes('external')) return false;
    const url = new URL(anchor.href, location.href);
    if (url.origin !== location.origin) return false; // external
    return true;
};

/**
 * Client-side navigation link. Renders an `<a href>` and intercepts same-origin,
 * same-tab, unmodified left-clicks to perform a soft navigation via the router;
 * everything else falls through to a normal full-page navigation.
 *
 * Built with Solid's isomorphic `Dynamic` (no JSX) so it server-renders and
 * hydrates identically to a plain anchor.
 *
 * @example
 * ```tsx
 * import { Link } from 'solidstep/link';
 * <Link href="/about" prefetch="hover">About</Link>
 * ```
 */
export const Link = (props: LinkProps): JSX.Element => {
    const [local, others] = splitProps(props, [
        'href',
        'replace',
        'prefetch',
        'scroll',
        'viewTransition',
        'onClick',
        'ref',
        'children',
    ]);

    let anchor: HTMLAnchorElement | undefined;
    const setRef = (el: HTMLAnchorElement) => {
        anchor = el;
        const r = local.ref as
            | ((el: HTMLAnchorElement) => void)
            | HTMLAnchorElement
            | undefined;
        if (typeof r === 'function') r(el);
    };

    const doPrefetch = () => {
        if (isServer || local.prefetch === false) return;
        try {
            const url = new URL(local.href, location.href);
            if (url.origin === location.origin) {
                prefetchRoute(url.pathname + url.search);
            }
        } catch {
            // best-effort
        }
    };

    const handleClick = (e: MouseEvent) => {
        const userOnClick = local.onClick as
            | ((e: MouseEvent) => void)
            | undefined;
        if (typeof userOnClick === 'function') userOnClick(e);
        const el = e.currentTarget as HTMLAnchorElement;
        if (!shouldIntercept(e, el, props.target as string | undefined)) return;
        e.preventDefault();
        void navigate(local.href, {
            replace: local.replace,
            scroll: local.scroll,
            viewTransition: local.viewTransition,
        });
    };

    const hoverPrefetch =
        local.prefetch === undefined || local.prefetch === 'hover';

    onMount(() => {
        if (isServer) return;
        if (local.prefetch === true) doPrefetch();
        if (
            local.prefetch === 'viewport' &&
            anchor &&
            'IntersectionObserver' in window
        ) {
            const io = new IntersectionObserver((entries) => {
                for (const entry of entries) {
                    if (entry.isIntersecting) {
                        doPrefetch();
                        io.disconnect();
                        break;
                    }
                }
            });
            io.observe(anchor);
            onCleanup(() => io.disconnect());
        }
    });

    const anchorProps: any = mergeProps(
        {
            component: 'a',
            ref: setRef,
            onClick: handleClick,
            onMouseEnter: hoverPrefetch ? doPrefetch : undefined,
            onFocus: hoverPrefetch ? doPrefetch : undefined,
            get href() {
                return local.href;
            },
        },
        others,
        {
            get children() {
                return local.children;
            },
        },
    );

    return createComponent(Dynamic, anchorProps);
};

export default Link;
