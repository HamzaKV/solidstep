import { createSignal, batch } from 'solid-js';
import { isServer } from 'solid-js/web';
import { deserialize } from 'seroval';
import { matchClientRoute } from './client-manifest.js';
import { preloadHandler } from './client-modules.js';
import { parseSearchParams, type SearchParams } from './path-router.js';

/**
 * Client-side router runtime: a single reactive `RouteState` signal plus the
 * navigation primitives (`navigate`, `prefetchRoute`, `refreshRoute`) and the
 * public hooks (`useRouter`, `useNavigate`, `usePathname`, `useSearchParams`,
 * `navigationPending`). The reactive segment tree in `client.ts` reads this
 * signal; updating it swaps only the changed route segments.
 *
 * Loaders never run here — a navigation fetches resolved data from the
 * `/__solidstep_route` endpoint (a seroval-serialized envelope, so Date/Map/etc.
 * survive).
 */

/** Endpoint that returns a route's full loader data + metadata envelope. */
const ROUTE_ENDPOINT = '/__solidstep_route';

/**
 * Typed-routes registry. The build/dev typegen plugin (`utils/typegen`) emits a
 * `solidstep-env.d.ts` that declaration-merges this interface with the app's
 * actual routes:
 *
 * ```ts
 * declare module 'solidstep/router' {
 *   interface Register {
 *     routes: '/' | '/blog/[slug]';
 *     hrefs: '/' | `/blog/${string}`;
 *     params: { '/': {}; '/blog/[slug]': { slug: string } };
 *   }
 * }
 * ```
 *
 * When present, `<Link href>` / {@link navigate} / {@link RouteParams} become
 * route-aware. When absent (no typegen run yet), the helpers below fall back to
 * accepting any string, so projects always compile.
 */
// biome-ignore lint/suspicious/noEmptyInterface: augmented via declaration merging
export interface Register {}

type _RegisteredHref = Register extends { hrefs: infer H extends string }
    ? H
    : never;

/**
 * A valid app route href. Resolves to the union of the app's route href patterns
 * (with optional `?query`/`#hash` suffixes) when typed routes are generated, or
 * any string otherwise.
 */
export type Href = [_RegisteredHref] extends [never]
    ? string & {}
    :
          | _RegisteredHref
          | `${_RegisteredHref}?${string}`
          | `${_RegisteredHref}#${string}`;

/** The union of the app's route ids (e.g. `'/blog/[slug]'`), or `string`. */
export type RouteId = Register extends { routes: infer R extends string }
    ? R
    : string;

/** The route params for a given route id (e.g. `{ slug: string }`). */
export type RouteParams<P extends RouteId = RouteId> = Register extends {
    params: infer M;
}
    ? P extends keyof M
        ? M[P]
        : Record<string, string | string[]>
    : Record<string, string | string[]>;

/**
 * Props a page/layout component receives for a given route id. `L` is the
 * loader's return type (pass it explicitly, e.g.
 * `PageProps<'/blog/[slug]', LoaderData>`).
 */
export type PageProps<P extends RouteId = RouteId, L = unknown> = {
    routeParams: RouteParams<P>;
    searchParams: SearchParams;
    loaderData: L;
};

/** The leaf variant the tree should render for the current route. */
export type RouteKind = 'page' | 'not-found' | 'error';

export type RouteState = {
    pathname: string;
    search: string;
    params: Record<string, string | string[]>;
    searchParams: SearchParams;
    /** The matched page's manifestPath (used to re-derive components). */
    manifestPath: string;
    loaderData: Record<string, any>;
    deferredKeys: string[];
    kind: RouteKind;
    /** For `kind === 'error'`: the error-page manifestPath + message. */
    errorPageManifest?: string;
    errorMessage?: string;
    /** First-load PPR flag: holes are filled by client fetch, not the envelope. */
    ppr: boolean;
    /**
     * `true` only for the state the server hydrated. Deferred nodes then read
     * streamed hydration data via a Solid resource; after any navigation the
     * envelope already carries resolved data, so this is `false`.
     */
    firstLoad: boolean;
};

/** The envelope shape returned by `/__solidstep_route`. */
type RouteEnvelope =
    | {
          type: 'page';
          manifestPath: string;
          params: Record<string, string | string[]>;
          searchParams: SearchParams;
          loaderData: Record<string, any>;
          deferredKeys: string[];
          meta: Record<string, any>;
      }
    | { type: 'redirect'; location: string }
    | {
          type: 'error';
          errorPageManifest: string;
          params: Record<string, string | string[]>;
          searchParams: SearchParams;
          message: string;
          meta?: Record<string, any>;
      }
    | { type: 'not-found' }
    | { type: 'route' };

/** The structural part of the route — everything except loader data. */
export type RouteStructure = Omit<RouteState, 'loaderData'>;

const EMPTY_STRUCTURE: RouteStructure = {
    pathname: '/',
    search: '',
    params: {},
    searchParams: {},
    manifestPath: '',
    deferredKeys: [],
    kind: 'page',
    ppr: false,
    firstLoad: false,
};

// Split state into two signals so navigation (a structure change) re-renders the
// route tree, while a same-route revalidation (a loader-data change) updates the
// mounted components in place — preserving their local state (e.g. form state).
const [structure, setStructure] = createSignal<RouteStructure>(EMPTY_STRUCTURE);
const [loaderData, setLoaderData] = createSignal<Record<string, any>>({});
const [pending, setPending] = createSignal(false);

/** Reactive accessor for the structural route state (drives tree structure). */
export const routeStructure = structure;
/** Reactive accessor for the current route's loader data (updates in place). */
export const routeLoaderData = loaderData;
/** Reactive accessor for the merged route state (for hooks/user code). */
export const route = (): RouteState => ({
    ...structure(),
    loaderData: loaderData(),
});
/** Reactive accessor: `true` while a navigation's data is in flight. */
export const navigationPending = pending;

const setRouteFull = (state: RouteState) => {
    const { loaderData: data, ...rest } = state;
    setStructure(rest);
    setLoaderData(data);
};

/** Build a not-found route state for the given URL. */
const notFoundState = (url: URL): RouteState => ({
    ...EMPTY_STRUCTURE,
    pathname: url.pathname,
    search: url.search,
    searchParams: parseSearchParams(url.searchParams),
    kind: 'not-found',
    loaderData: {},
});

let initialized = false;

/**
 * Seed the router with the state the server hydrated, and install the
 * `popstate` listener + manual scroll restoration. Called once by `client.ts`
 * before `hydrate()`.
 */
export const initRouter = (initial: RouteState) => {
    setRouteFull(initial);
    if (initialized || isServer) return;
    initialized = true;
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    // Record the initial scroll position against the current history entry.
    saveScroll();
    window.addEventListener('popstate', onPopState);
};

// ---------------------------------------------------------------------------
// Scroll restoration (per history entry)
// ---------------------------------------------------------------------------

const scrollPositions = new Map<string, { x: number; y: number }>();
const scrollKey = () => `${location.pathname}${location.search}`;
const saveScroll = () => {
    if (isServer) return;
    scrollPositions.set(scrollKey(), { x: window.scrollX, y: window.scrollY });
};

// ---------------------------------------------------------------------------
// Data fetching (+ prefetch cache)
// ---------------------------------------------------------------------------

const PREFETCH_TTL = 30_000;
const prefetchCache = new Map<
    string,
    { expires: number; promise: Promise<RouteEnvelope> }
>();

const fetchEnvelope = (target: string): Promise<RouteEnvelope> =>
    fetch(`${ROUTE_ENDPOINT}?url=${encodeURIComponent(target)}`)
        .then((r) => r.text())
        .then((text) => deserialize(text) as RouteEnvelope);

/**
 * Prefetch (and cache) a route's data envelope and warm its component modules.
 * Safe to call repeatedly; in-flight requests are de-duplicated.
 */
export const prefetchRoute = (target: string): void => {
    if (isServer) return;
    const cached = prefetchCache.get(target);
    if (cached && cached.expires > Date.now()) return;
    const promise = fetchEnvelope(target);
    prefetchCache.set(target, { expires: Date.now() + PREFETCH_TTL, promise });
    // Warm the component modules for the target path.
    try {
        const url = new URL(target, location.href);
        const match = matchClientRoute(url.pathname);
        if (match) void preloadHandler(match.handler);
    } catch {
        // ignore — prefetch is best-effort
    }
};

const takeEnvelope = (target: string): Promise<RouteEnvelope> => {
    const cached = prefetchCache.get(target);
    if (cached && cached.expires > Date.now()) {
        prefetchCache.delete(target);
        return cached.promise;
    }
    return fetchEnvelope(target);
};

// ---------------------------------------------------------------------------
// Metadata application
// ---------------------------------------------------------------------------

// Tags we never overwrite when applying a navigation's meta (set once at boot).
const PRESERVED_META = new Set(['charset', 'viewport', 'build_time']);

const applyMeta = (meta: Record<string, any> | undefined) => {
    if (isServer || !meta) return;
    for (const [key, value] of Object.entries(meta)) {
        if (PRESERVED_META.has(key)) continue;
        if (value?.type === 'title') {
            document.title = String(value.content ?? '');
        } else if (value?.type === 'meta' && value.attributes) {
            const { name, property } = value.attributes;
            const selector = name
                ? `meta[name="${name}"]`
                : property
                  ? `meta[property="${property}"]`
                  : null;
            let el = selector
                ? document.head.querySelector<HTMLMetaElement>(selector)
                : null;
            if (!el) {
                el = document.createElement('meta');
                document.head.appendChild(el);
            }
            for (const [k, v] of Object.entries(value.attributes)) {
                el.setAttribute(k, String(v));
            }
        }
    }
};

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

export type NavigateOptions = {
    replace?: boolean;
    scroll?: boolean;
    /**
     * Wrap the navigation commit in `document.startViewTransition()`. Ignored
     * when the API is unsupported or `prefers-reduced-motion: reduce` is set.
     */
    viewTransition?: boolean;
};

const isModifiedHardNav = (url: URL): boolean => url.origin !== location.origin;

// Commit with `batch` (NOT a transition): a Solid transition would hold the old
// UI until the new tree's resources settle, which would defeat the instant-shell
// UX — we want a brand-new deferred boundary to show its loading.tsx fallback
// immediately. `navigationPending` covers the envelope-fetch window; per-hole
// loading is handled by <Suspense> once the shell is committed.
const commit = (state: RouteState) => batch(() => setRouteFull(state));

const prefersReducedMotion = (): boolean =>
    typeof matchMedia === 'function' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Run `fn` inside `document.startViewTransition()` when requested and
 * supported; otherwise run it directly. `fn` must be synchronous (it performs
 * the DOM-mutating commit) so the transition can capture the before/after
 * snapshot correctly.
 */
const withViewTransition = (
    viewTransition: boolean | undefined,
    fn: () => void,
): void => {
    if (
        viewTransition &&
        typeof document.startViewTransition === 'function' &&
        !prefersReducedMotion()
    ) {
        document.startViewTransition(() => fn());
        return;
    }
    fn();
};

const stateFromEnvelope = (
    envelope: Extract<RouteEnvelope, { type: 'page' | 'error' }>,
    url: URL,
): RouteState => {
    if (envelope.type === 'error') {
        return {
            pathname: url.pathname,
            search: url.search,
            params: envelope.params,
            searchParams: envelope.searchParams,
            manifestPath: '',
            loaderData: {},
            deferredKeys: [],
            kind: 'error',
            errorPageManifest: envelope.errorPageManifest,
            errorMessage: envelope.message,
            ppr: false,
            firstLoad: false,
        };
    }
    return {
        pathname: url.pathname,
        search: url.search,
        params: envelope.params,
        searchParams: envelope.searchParams,
        manifestPath: envelope.manifestPath,
        loaderData: envelope.loaderData,
        deferredKeys: envelope.deferredKeys,
        kind: 'page',
        ppr: false,
        firstLoad: false,
    };
};

/**
 * Soft-navigate to `to`. Falls back to a full-page navigation for external,
 * non-page, or failed requests. Updates history, swaps the reactive route
 * state, applies metadata, and manages scroll.
 */
export const navigate = async (
    to: string,
    opts: NavigateOptions = {},
): Promise<void> => {
    if (isServer) return;
    const url = new URL(to, location.href);
    if (isModifiedHardNav(url)) {
        location.assign(to);
        return;
    }
    const target = url.pathname + url.search;
    saveScroll();
    setPending(true);
    try {
        const envelope = await takeEnvelope(target);
        switch (envelope.type) {
            case 'redirect':
                await navigate(envelope.location, { replace: true });
                return;
            case 'route':
            case 'not-found':
                if (envelope.type === 'route') {
                    location.assign(to);
                    return;
                }
                break;
        }

        if (envelope.type === 'page' || envelope.type === 'error') {
            const match = matchClientRoute(url.pathname);
            if (match) await preloadHandler(match.handler);
        }

        // Record the view-transition preference on this entry's own history
        // state so a later back/forward landing back on it (`onPopState`) can
        // replay the same transition it arrived with.
        const historyState = { viewTransition: !!opts.viewTransition };
        if (opts.replace) {
            history.replaceState(historyState, '', target);
        } else {
            history.pushState(historyState, '', target);
        }

        withViewTransition(opts.viewTransition, () => {
            if (envelope.type === 'not-found') {
                commit(notFoundState(url));
            } else {
                const meta = 'meta' in envelope ? envelope.meta : undefined;
                commit(stateFromEnvelope(envelope, url));
                applyMeta(meta);
            }
        });

        if (opts.scroll !== false) {
            if (url.hash) {
                document.getElementById(url.hash.slice(1))?.scrollIntoView();
            } else {
                window.scrollTo(0, 0);
            }
        }
    } catch {
        // Network/parse/module failure → hard navigate so the user still moves.
        location.assign(to);
    } finally {
        setPending(false);
    }
};

const onPopState = async () => {
    const url = new URL(location.href);
    const target = url.pathname + url.search;
    setPending(true);
    try {
        const envelope = await fetchEnvelope(target);
        if (envelope.type === 'redirect') {
            location.assign(envelope.location);
            return;
        }
        if (envelope.type === 'route') {
            location.reload();
            return;
        }
        const viewTransition = (
            history.state as { viewTransition?: boolean } | null
        )?.viewTransition;
        if (envelope.type === 'page' || envelope.type === 'error') {
            const match = matchClientRoute(url.pathname);
            if (match) await preloadHandler(match.handler);
            const meta = 'meta' in envelope ? envelope.meta : undefined;
            withViewTransition(viewTransition, () => {
                commit(stateFromEnvelope(envelope, url));
                applyMeta(meta);
            });
        } else {
            withViewTransition(viewTransition, () =>
                commit(notFoundState(url)),
            );
        }
        // Restore the saved scroll position for this history entry.
        const saved = scrollPositions.get(target);
        if (saved)
            requestAnimationFrame(() => window.scrollTo(saved.x, saved.y));
    } catch {
        location.reload();
    } finally {
        setPending(false);
    }
};

/**
 * Re-fetch the current route's loader data + metadata and update in place
 * (used by server-action revalidation). The reactive props mean mounted
 * components see the new data without remounting.
 */
export const refreshRoute = async (): Promise<void> => {
    if (isServer) return;
    const url = new URL(location.href);
    const envelope = await fetchEnvelope(url.pathname + url.search);
    if (envelope.type === 'page') {
        // Update only the loader data (+ metadata) — NOT the structure — so the
        // currently mounted components update in place and keep their local
        // state instead of remounting.
        setLoaderData(envelope.loaderData);
        applyMeta(envelope.meta);
    }
};

// ---------------------------------------------------------------------------
// Public hooks
// ---------------------------------------------------------------------------

/** A route-aware navigation function (accepts a typed {@link Href}). */
export type NavigateFn = (to: Href, opts?: NavigateOptions) => Promise<void>;

/** Returns the imperative `navigate(to, opts)` function. */
export const useNavigate = (): NavigateFn => navigate;
/** Reactive accessor for the current pathname. */
export const usePathname = () => () => route().pathname;
/** Reactive accessor for the current search params. */
export const useSearchParams = () => () => route().searchParams;
/** The full router API: route accessor, navigate, refresh, and pending signal. */
export const useRouter = () => ({
    route,
    navigate,
    refresh: refreshRoute,
    pending: navigationPending,
});
