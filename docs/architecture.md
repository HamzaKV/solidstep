# Architecture

[← Back to docs index](./README.md)

A high-level overview of how a SolidStep request is handled, from URL to hydrated page. This page describes internals to help you reason about behavior; the public API is documented in the [guides](./README.md#guides).

## Request Lifecycle

```
Request
  → middleware (onRequest)
  → match route against the manifest
  ├─ internal endpoint?
  │    /_server            → server-action handler        ──► seroval stream
  │    /__solidstep_route  → soft-nav envelope            ──► seroval string
  │    /__solidstep_loader → PPR/deferred hole data       ──► seroval string
  ├─ API route (route.ts)  → method handler (GET/POST/…)  ──► Response
  └─ page route
       → resolve render strategy (dynamic | static | isr | ppr)
       → run loaders (sequential awaited; deferred left pending)
       → render: renderToString (template) or renderToStream (streaming)
  → middleware (onBeforeResponse)
  → Response
```

Instrumentation hooks (`onRequest`, `onResponseEnd`, `onRequestError`) wrap this flow — see [Instrumentation](./instrumentation.md).

The numbered sections below walk each stage in order.

## 1. Route Manifest

At server startup, SolidStep builds an in-memory route manifest from Vinxi's file routes (`vinxi/routes`). It walks every discovered file, classifies each as a `route` (API), `layout`, `loading`, `error`, `not-found`, or `group` (parallel `@slot`), and assembles a trie of route nodes via `insertRoute` (see `utils/path-router.ts` and `utils/router.ts`).

For each page route it precomputes the chain of nested layouts (root → leaf), the matching `loading` and `error` pages, the root `not-found` page, and any parallel-route groups attached to that path. API routes (`route.ts`) are inserted as `route`-type nodes carrying their handler import.

The manifest is built once and reused. In production, dynamically imported route modules are additionally memoized in a module cache; in dev the cache is skipped so HMR invalidations are respected.

## 2. Matching

For each incoming request, `matchRoute(manifest, pathname)` walks the trie and returns the matched handler plus extracted `params` (including dynamic `[slug]`, catch-all `[...path]`, and optional catch-all `[[...path]]` segments). Before matching against page/API routes, the handler short-circuits a set of **internal endpoints**:

- `/_server` — the server-action handler. Arguments and return values are seroval-serialized (see section 6).
- `/__solidstep_route` — the **soft-navigation envelope**. Returns a seroval-serialized string describing how the client should render a target route (loader data, metadata, redirect/error/not-found state). See [Soft Navigation](#soft-navigation).
- `/__solidstep_loader` — **deferred / PPR hole data**. The client fetches a single deferred loader's resolved data here to fill a hole left pending in the initial shell. See [Streaming, Deferred Loaders & PPR](#streaming-deferred-loaders--ppr).

Otherwise:

- If the match is an **API route**, the corresponding method export (`GET`/`POST`/...) is invoked and its `Response` is returned directly.
- If the match is a **page**, rendering proceeds (next sections).
- If there is **no match**, the root `not-found` page is rendered with a `404` status.

## 3. Loaders: Sequential vs Deferred

The `render()` function (in `server.ts`) resolves the page variant to render (`main`, `loading`, `error`, or `not-found`). It then runs **every layout loader along the route path and the page loader concurrently** (`Promise.all`) rather than sequentially down the layout chain. Results are keyed by each node's manifest path and applied in tree order, so `loaderData` ordering is deterministic while the awaits overlap. Parallel-route group loaders run alongside the last layout.

Each loader (from `defineLoader`) carries a `type`:

- **`sequential`** (the default) — the loader is **awaited** before render; its data is part of the initial HTML.
- **`defer`** — the loader is **not awaited** at render time. The resolved value is delivered later, either streamed in (deferred routes) or fetched by the client to fill a hole (PPR). See section below.

```
loaders for a route
  ├─ sequential  → awaited (Promise.all)  → in initial HTML
  └─ defer       → left pending           → resolved via stream or /__solidstep_loader
```

Layouts and the page are composed inside-out (`reduceRight`) into a single component tree, metadata from each node is merged, and per-module CSS/asset lists are collected from the client manifest.

## 4. Render Strategies

A page's `render` option (set in its `options` export — see [Rendering Strategies](./rendering.md)) selects how the matched page is produced. The handler in `server.ts` branches on this:

| Strategy   | When rendered                  | How served                                                                                   |
| ---------- | ------------------------------ | -------------------------------------------------------------------------------------------- |
| `dynamic`  | per request (default)          | `renderToString` (or `renderToStream` if it has deferred loaders / streaming groups).        |
| `static`   | build time (SSG)               | prerendered full-HTML artifact, served as-is.                                                |
| `isr`      | build time, then on a schedule | cached full-HTML artifact served with stale-while-revalidate; regenerated by a self-fetch.   |
| `ppr`      | shell at render, holes later   | synchronous shell via `renderToString` (deferred holes stay pending → fallback); client fills holes via `/__solidstep_loader`. |

Notes on the cache-backed strategies:

- **SSG/ISR/PPR** pages are enumerated and prerendered by the build-time crawler (`prerender-crawl.ts`), driven by each page's `options.render` and `generateStaticParams`.
- **ISR** uses an `isr:<pathname>` cache key. A request serves the cached artifact and, if stale, kicks off a background regeneration by self-fetching the page with an `x-solidstep-isr-bypass` header (so the regeneration renders fresh instead of recursing into the cache). ISR artifacts written by the crawler are seeded into the cache on server startup.
- Plain `dynamic` `main` responses may also be cached per path according to the page's [cache options](./caching.md). Streaming (deferred) responses are **not** page-cached.

## 5. Rendering & Streaming SSR

For a non-deferred `dynamic` page (and for SSG/ISR shells), the composed tree is rendered to a string with `renderToString` from `solid-js/web`.

When a `loading.tsx` exists for the route, SolidStep streams the result in stages:

1. **loading** — the loading variant is rendered and pushed first, with a hydration script targeting the loading page, so the user sees content immediately.
2. **main** — the full page is then rendered; a script swaps the document head and body to the final content and triggers hydration of the main page.
3. **error** — if rendering throws and an `error.tsx` exists, the error variant is rendered with a `500` status (a thrown `RedirectError` instead produces a `302` with a `Location` header).

Each stage emits a hydration script that imports the client entry and calls `main(manifestPath, params, searchParams, loaderData)`, passing the server-resolved loader data so the client does not re-fetch.

## 6. Streaming, Deferred Loaders & PPR

When a route has **deferred loaders** (`type: 'defer'`) or a streaming parallel-route group, and the `main` variant is being rendered for a non-PPR page, `render()` hands the composed tree back to the handler to stream via `renderToStream` from `solid-js/web`:

```
renderToStream + <Suspense fallback={loading.tsx}>
  ┌──────────────────────────────────────────────┐
  │ <head> + shell emitted immediately            │
  │ deferred loader suspends → fallback shown      │
  │ loader resolves → chunk flushed → content swaps│
  └──────────────────────────────────────────────┘
```

The `<head>` (metadata + assets) is fully populated by the awaited compose step, so it can be emitted before the deferred content resolves. Deferred resources are created via `createDeferredResource` (`utils/deferred.ts`): given a promise on the server it suspends until resolution; with no promise (the client hydration path) it starts pending.

**PPR (Partial Prerendering)** is the static-shell variant. A PPR page renders a **synchronous shell** with `renderToString` — its deferred loaders are deliberately left pending so `renderToString` emits their `<Suspense>` fallbacks as holes. `render()` returns the shell HTML plus the list of hole manifest paths (`pprHoles`). The shell can therefore be prerendered/cached, and the client fills each hole at runtime:

```
PPR shell (static)            client hydration
  hole A (fallback)  ──fetch──►  GET /__solidstep_loader?…  ──► seroval data ──► hole A filled
  hole B (fallback)  ──fetch──►  GET /__solidstep_loader?…  ──► seroval data ──► hole B filled
```

Each `/__solidstep_loader` response runs a single deferred loader and returns its data seroval-serialized.

## 7. Client Hydration

The client entry (`client.ts`) exposes `main(...)`. Given the module path, it reconstructs the same layout chain and parallel-route groups from `vinxi/routes`, rehydrates each node with the loader data passed from the server, composes the tree, and calls `hydrate()` from `solid-js/web` against the document. It seeds the client router (`initRouter`) with the server's route state before hydrating, and handles single-flight mutation revalidation by re-applying a DOM diff on page show when a path was revalidated.

## 8. Soft Navigation

After hydration the client router (`utils/router-context.ts`) takes over in-app navigation so a `<Link>` click does **not** reload the document.

**Envelope fetch.** On navigate, the router fetches `GET /__solidstep_route?url=<target>` and `deserialize`s the seroval-serialized response into a `RouteEnvelope`. Because the envelope is seroval (not JSON), loader-data types like `Date`, `Map`, and `Set` survive the round trip — the client receives the same value shapes the server produced. The envelope is a tagged union: `page`, `error`, `redirect`, `not-found`, or `route` (a non-page/API path). Redirects re-navigate; `route` and external/modified-click targets fall back to a full-page `location.assign`; failures (network/parse/module load) also hard-navigate so the user still moves.

```
<Link> click / navigate(to)
  → GET /__solidstep_route?url=<to>
  → deserialize (seroval)  → RouteEnvelope
  → preload the target route's client modules
  → history.pushState / replaceState
  → commit(envelope state)   → reactive signals update
  → applyMeta + scroll
```

**Two signals: structure vs data.** The route state is split into two reactive signals so updates are surgical:

- `routeStructure` — pathname, params, `manifestPath`, `deferredKeys`, `kind`, etc. A change here means a different route tree, so the components remount.
- `routeLoaderData` — the per-node loader data, keyed by manifest path.

A **navigation** (structure change) re-renders the route tree. A **same-route revalidation** changes only `routeLoaderData`, so the already-mounted components update **in place without remounting** — preserving local component state (e.g. form input). Both are applied together inside a `batch` so the commit is atomic. `navigationPending` is reactive `true` while the envelope is in flight.

**Prefetch.** `prefetchRoute(target)` fetches and caches the envelope ahead of time (a 30s TTL prefetch cache) and warms the target's component modules, so a subsequent navigation can commit immediately. The `<Link>` component uses this for prefetch-on-intent. History is handled via `pushState`/`replaceState` plus a `popstate` listener with manual scroll restoration per history entry.

## 9. Server-Action Serialization

Server actions (`'use server'`) are invoked over the network at the `/_server` endpoint. Arguments and return values are (de)serialized with [seroval](https://github.com/lxsmnsyc/seroval) using a shared plugin set (`utils/serialize.ts`) that supports `FormData`, `Headers`, `Request`/`Response`, `URL`, `ReadableStream`, and more.

Values are **cross-serialized into a chunked `ReadableStream`** (`serializeToStream`): each frame is length-prefixed with a 12-byte header (`;0x<8 hex digits>;`) followed by the UTF-8 payload. The first chunk carries the cross-reference header so references that arrive in later chunks (e.g. streamed promises or readable streams) resolve correctly. The receiving side (`SerovalChunkReader`) buffers partial reads until a full frame is available, then deserializes it. This streaming format is what lets server actions return complex/async values — and is why returning plain values that aren't seroval-serializable can surprise you (see [Troubleshooting](./troubleshooting.md#server-action-returning-unexpected-types)).

## Related

- [Routing](./routing.md) — the file conventions that feed the manifest.
- [Data Loading](./data-loading.md) — authoring loaders.
- [Caching](./caching.md) — page caching and revalidation.
- [Rendering Strategies](./rendering.md) — choosing dynamic/static/isr/ppr.
- [Instrumentation](./instrumentation.md) — observing the lifecycle.
- [Testing](./testing.md) — unit and e2e tests that exercise this lifecycle.
