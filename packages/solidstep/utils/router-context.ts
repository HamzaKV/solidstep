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

const MAX_SCROLL_POSITIONS = 100;
const scrollPositions = new Map<string, { x: number; y: number }>();
const scrollKey = () => `${location.pathname}${location.search}`;
const saveScroll = () => {
    if (isServer) return;
    const key = scrollKey();
    // Refresh insertion order so the cap below evicts the least-recent entry.
    scrollPositions.delete(key);
    scrollPositions.set(key, { x: window.scrollX, y: window.scrollY });
    if (scrollPositions.size > MAX_SCROLL_POSITIONS) {
        // Oldest-first eviction (Map preserves insertion order); losing an
        // ancient entry only means that entry restores to top instead.
        scrollPositions.delete(scrollPositions.keys().next().value!);
    }
};

// ---------------------------------------------------------------------------
// Data fetching (+ prefetch cache)
// ---------------------------------------------------------------------------

const PREFETCH_TTL = 30_000;
const MAX_PREFETCH_ENTRIES = 64;
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
    // Re-inserting deletes first so the entry moves to the back of the Map's
    // insertion order (fairness for the oldest-first cap below).
    prefetchCache.delete(target);
    const promise = fetchEnvelope(target);
    prefetchCache.set(target, { expires: Date.now() + PREFETCH_TTL, promise });
    if (prefetchCache.size > MAX_PREFETCH_ENTRIES) {
        // Never-navigated prefetches (e.g. many viewport links) must not
        // accumulate resolved envelopes for the whole session.
        prefetchCache.delete(prefetchCache.keys().next().value!);
    }
    // Warm the component modules for the target path.
    try {
        const url = new URL(target, location.href);
        const match = matchClientRoute(url.pathname);
        // Prefetch is speculative: a failed chunk load is not actionable here.
        if (match) preloadHandler(match.handler).catch(() => undefined);
    } catch {
        // ignore — prefetch is best-effort
    }
};

/** Test-only visibility into the module-private caches. Not public API. */
export const __routerInternals = {
    prefetchCacheSize: () => prefetchCache.size,
    scrollPositionsSize: () => scrollPositions.size,
};

const takeEnvelope = (target: string): Promise<RouteEnvelope> => {
    const cached = prefetchCache.get(target);
    if (cached) {
        // Consuming removes the entry either way: fresh ones are used, expired
        // ones are dead weight that would otherwise sit in the map forever.
        prefetchCache.delete(target);
        if (cached.expires > Date.now()) return cached.promise;
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
    // Every tag this pass creates/updates is stamped `data-ss-meta` and
    // recorded; any previously stamped tag NOT touched by this route's meta is
    // removed afterwards, so tags never leak across navigations. Server-emitted
    // meta carries the same stamp (see utils/html.ts) so first-load tags
    // participate in the diff too.
    const touched = new Set<Element>();
    for (const [key, value] of Object.entries(meta)) {
        if (PRESERVED_META.has(key)) continue;
        if (value?.type === 'title') {
            document.title = String(value.content ?? '');
        } else if (value?.type === 'meta' && value.attributes) {
            const { name, property } = value.attributes;
            // CSS.escape keeps a quote/bracket in the value from breaking the
            // selector (escapes are valid inside quoted attribute strings).
            const selector = name
                ? `meta[name="${CSS.escape(String(name))}"]`
                : property
                  ? `meta[property="${CSS.escape(String(property))}"]`
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
            el.setAttribute('data-ss-meta', '');
            touched.add(el);
        } else if (
            (value?.type === 'link' ||
                value?.type === 'script' ||
                value?.type === 'style') &&
            value.attributes
        ) {
            // No stable identity to diff against (a route may declare several
            // links/scripts) — create fresh each pass; the sweep below removes
            // the previous route's stamped ones.
            const el = document.createElement(value.type);
            for (const [k, v] of Object.entries(value.attributes)) {
                el.setAttribute(k, String(v));
            }
            el.setAttribute('data-ss-meta', '');
            document.head.appendChild(el);
            touched.add(el);
        }
    }
    // Sweep every stamped head tag (meta/link/script/style) the new route's
    // meta didn't touch, so nothing leaks across navigations.
    for (const el of document.head.querySelectorAll('[data-ss-meta]')) {
        if (!touched.has(el)) el.remove();
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

// Monotonic navigation generation, shared by `navigate` and `onPopState`.
// Each navigation stamps itself at entry and re-checks after every await:
// only the latest navigation may touch history, commit state, or clear the
// pending signal — a slower, older response is silently discarded.
let navGen = 0;

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
        const transition = document.startViewTransition(() => fn());
        // The commit already happened synchronously above; this only stops an
        // exception thrown inside it (which the browser reports by rejecting
        // this promise) from surfacing as an unhandled rejection.
        transition.updateCallbackDone.catch((error: unknown) => {
            console.error(
                '[solidstep] view transition callback failed:',
                error,
            );
        });
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
    const gen = ++navGen;
    const target = url.pathname + url.search;
    saveScroll();
    setPending(true);
    try {
        // The route match is derivable synchronously from the URL, so start
        // warming its component modules in parallel with the envelope fetch
        // instead of waiting for the fetch to land first. `preloadHandler`
        // rejects on a failed chunk load; the immediate `.catch` below only
        // keeps a *dangling* preload (redirect/route/not-found paths) from
        // becoming an unhandled rejection — the `await preload` further down
        // still observes the rejection and triggers the hard-nav fallback.
        const match = matchClientRoute(url.pathname);
        const preload = match ? preloadHandler(match.handler) : undefined;
        preload?.catch(() => undefined);

        const envelope = await takeEnvelope(target);
        if (gen !== navGen) return; // superseded by a newer navigation
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

        if (
            (envelope.type === 'page' || envelope.type === 'error') &&
            preload
        ) {
            await preload;
            if (gen !== navGen) return; // superseded while preloading
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
        // Network/parse/module failure → hard navigate so the user still
        // moves. A superseded navigation's failure is not ours to handle.
        if (gen === navGen) location.assign(to);
    } finally {
        // Only the latest navigation clears pending; an older one finishing
        // (or being discarded) must not flip it off under the one in flight.
        if (gen === navGen) setPending(false);
    }
};

const onPopState = async () => {
    const gen = ++navGen;
    const url = new URL(location.href);
    const target = url.pathname + url.search;
    setPending(true);
    try {
        // Same rationale as `navigate()`: warm modules in parallel with the
        // envelope fetch instead of after it; the immediate `.catch` only
        // guards the dangling (redirect/route) paths against an unhandled
        // rejection — `await preload` below still sees the failure.
        const match = matchClientRoute(url.pathname);
        const preload = match ? preloadHandler(match.handler) : undefined;
        preload?.catch(() => undefined);

        const envelope = await fetchEnvelope(target);
        if (gen !== navGen) return; // superseded by a newer navigation
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
            if (preload) {
                await preload;
                if (gen !== navGen) return; // superseded while preloading
            }
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
        if (gen === navGen) location.reload();
    } finally {
        if (gen === navGen) setPending(false);
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
export const usePathname = () => () => structure().pathname;
/** Reactive accessor for the current search params. */
export const useSearchParams = () => () => structure().searchParams;
/** The full router API: route accessor, navigate, refresh, and pending signal. */
export const useRouter = () => ({
    route,
    navigate,
    refresh: refreshRoute,
    pending: navigationPending,
});
