# solidstep

## 0.5.4

### Patch Changes

- f3afcd9: Fix: the top-level request handler now `await`s its delegated dispatch
  (`handleServerFunction`, `handleApiRoute`, `renderPage`) instead of returning
  the promise directly. Returning an unawaited promise from inside a `try` block
  does not let a later rejection reach that block's `catch` — it only chains
  onto the outer async function's own returned promise. A rejected server
  action, API route, or page render therefore surfaced as an unhandled
  rejection instead of the framework's mapped response: a thrown
  `RedirectError` never became its 302, and any other error skipped the
  dev-overlay/500 fallback entirely.
- 0a75396: Fix: the top-level request handler and `revalidatePath` matched server-action
  requests with `url.includes('_server')` / `path.includes('_server')` — a
  substring check. An ordinary page route whose path happened to contain
  `_server` (e.g. `/page_server`) was misrouted into the server-function
  dispatcher, and `revalidatePath` could be called from such a page without
  throwing its "server functions only" guard. Both now match the real
  `@vinxi/server-functions` mount point exactly: the pathname must equal
  `/_server` or start with `/_server/`.
- a0b5244: Fix: `handleServerFunction` resolved the target chunk and parsed the request's
  arguments (query-string JSON for bound args, `formData()`/`.json()` for a POST
  body) before the `try` block that runs the action and maps its errors. An
  unknown `functionId` or malformed input therefore threw unhandled, skipping
  the `onRequestError`/`onResponseEnd` instrumentation hooks entirely. Both now
  map to a proper response instead: an unresolvable server-function chunk
  returns 404, and malformed args/form-data/JSON input returns 400 — both still
  firing the instrumentation hooks like any other request.
- 267d20d: Fix: `defineConfig` computed a `middlewarePath` that fell back from
  `app/middleware.ts` to `app/middleware.js`, but the ssr router config
  hardcoded the literal `'./app/middleware.ts'` instead of using it. A project
  with only `app/middleware.js` (or no middleware file at all) silently got
  the wrong — or a nonexistent — middleware wired in. The resolved path is now
  actually passed to the router; `middleware` is `undefined` when neither file
  exists (vinxi's schema marks it optional).
- 74ce02b: Fix: if a page's own `error.tsx` threw while rendering the fallback for an
  earlier render failure, the secondary error was silently discarded — only
  the original error propagated, with no trace of why the error boundary
  itself never rendered. That secondary failure is now logged via the
  framework logger before the original error is re-thrown.

## 0.5.3

### Patch Changes

- 91533c7: Fix: the generated server router's Vite config now sets `ssr.noExternal` for
  `solidstep` itself. Without it, Vite's SSR dev/build pipeline externalizes
  `solidstep` like any ordinary `node_modules` dependency, so files that import
  Vite-only virtual specifiers (`vinxi/routes`, served exclusively by vinxi's own
  `resolveId`/`load` plugin hooks with no runtime `exports` condition) hit Node's
  real ESM resolver instead and throw `ERR_PACKAGE_PATH_NOT_EXPORTED`. This broke
  any page rendering a `<Link>` (which transitively imports `client-manifest.ts`)
  under `vinxi dev`. Production `vinxi build` was unaffected: build-time bundling
  resolves the whole SSR graph (including virtual modules) through Vite's plugin
  pipeline regardless of `noExternal`.

## 0.5.2

### Patch Changes

- Fix: relative imports/exports in the published ESM `dist` now carry explicit
  `.js` extensions. `tsc` (`moduleResolution: bundler`) compiled the previous
  extensionless specifiers without complaint, but Node's native ESM resolver
  (used by any consumer not going through a bundler, e.g. Vitest) threw
  `ERR_MODULE_NOT_FOUND` — most visibly on `solidstep/link` failing to resolve
  `./router-context`. Affected 30 files / 108 specifiers across the package.

## 0.5.1

### Patch Changes

- 4942154: Fix: `redirect()` thrown inside a **layout/group loader** is no longer swallowed
  into the per-node error sentinel. `runSequentialLoader` now re-throws
  `RedirectError`, so auth-gating layouts (e.g. `redirect('/login')` when a session
  cookie is missing) abort the render and issue the redirect response, matching the
  0.3.x behavior and the page-loader contract. Previously the gated layout rendered
  with a sentinel `loaderData`, typically crashing on missing user data (500) and
  leaking the gated tree render.

## 0.5.0

### Minor Changes

- 2fa1f1b: Cache robustness improvements (all additive):

  - **`MemoryCacheStore` byte budget.** A new `maxBytes` option caps the
    approximate total value size, evicting LRU entries to stay under it (the newest
    entry is always kept). Configure via `defineConfig({ cache: { type: 'memory',
maxEntries, maxBytes } })`. Guards memory-constrained runtimes where an
    entry-count limit alone can hold far more than expected when entries vary
    wildly in size (e.g. cached HTML). Sizes are only computed when `maxBytes` is
    set, so the default store is unaffected.
  - **Atomic filesystem tag index.** `FilesystemCacheStore` now writes
    `__tags.json` to a unique temp file and atomically renames it into place, so a
    crash mid-write can no longer leave a truncated index that breaks every later
    `invalidateTag`.
  - **`getCacheResult(key)`** (`solidstep/utils/cache`) — returns
    `{ hit, value }` so callers can distinguish a cache miss from a value
    deliberately cached as `null` (negative caching); `getCache` collapses both to
    `null`.
  - **`singleFlight(key, fn, timeoutMs?)`** — an optional eviction timeout so a
    hung `fn` (an upstream that never settles) no longer pins the key forever; after
    the timeout the next caller starts a fresh flight, and the original flight's
    late settle can't evict the newer one.

- c898548: Add client-side (soft) navigation. SolidStep is now a true SPA-on-navigation
  framework instead of a full-reload MPA:

  - **`<Link>`** (`solidstep/link`) and **`useNavigate`** (`solidstep/router`)
    perform soft navigations: the document is not reloaded, the target route's
    loader data + metadata are fetched in one request, and the page re-renders
    reactively. `<Link>` renders a real `<a href>` and is progressive-enhancement
    safe (works as a normal link with JS disabled or for external targets), with
    hover/viewport/eager `prefetch`.
  - New `solidstep/router` API: `useNavigate`, `useRouter`, `usePathname`,
    `useSearchParams`, and a `navigationPending` signal.
  - The root layout stays mounted across navigations; loader-data revalidation
    (from `revalidatePath` in a server action) now updates the mounted components
    **in place** (preserving local state like form inputs) by re-rendering
    reactively instead of patching the DOM.
  - History (back/forward), scroll restoration, and `<title>`/metadata updates are
    handled automatically. Redirects, errors, and not-found are resolved through a
    serialized route-data envelope so a client fetch can't follow or fail them.
  - **Removed the hand-rolled `diff-dom`** DOM-patching module; server-action
    revalidation now re-renders reactively (`refreshRoute`).

  Internally this adds a `/__solidstep_route` endpoint that resolves a route's full
  loader data + metadata (seroval-serialized, so Date/Map/etc. survive) and an
  isomorphic client route matcher that mirrors the server's route trie 1:1 for
  hydration-safe matching.

- ffd2da8: Add deferred page loaders (streaming SSR). Mark a page loader `type: 'defer'` and
  its data is exposed to the page as a Solid resource accessor read under
  `<Suspense>`. The framework renders such routes with Solid's `renderToStream`:
  the shell streams immediately (with the route's `loading.tsx` as the Suspense
  fallback) and the deferred data streams in and hydrates afterwards. Non-deferred
  routes are unchanged and keep the standard `renderToString` path. This is the
  foundation for partial pre-rendering (PPR).
- b162fe5: Developer-experience polish: typed routes, a dev error overlay, and a richer starter.

  - **Typed routes.** A build/dev Vite plugin scans `app/` and generates a
    `solidstep-env.d.ts` that declaration-merges your routes into the `Register`
    interface from `solidstep/router`. `<Link href>` and `useNavigate(to)` are then
    type-checked against your actual routes (typos are compile errors), and
    `PageProps<'/blog/[slug]'>` / `RouteParams<'/blog/[slug]'>` give typed
    `routeParams`. Projects without generated types still compile (the helpers fall
    back to accepting any string). The file is regenerated on `vinxi dev`/`build`;
    add it to `.gitignore`.
  - **Dev error overlay.** In development, an unhandled SSR error (no `error.tsx`),
    a server-action error, or a client hydration/navigation error now shows a rich
    in-browser overlay (message + stack) instead of a bare 500. Routes with an
    `error.tsx` still render it. Production behavior is unchanged (the overlay is
    tree-shaken out).
  - **Richer `create-solidstep` starter.** The default template is now a guided
    tour: `<Link>` navigation with a pending indicator, a loader page, a static
    page, a dynamic `[slug]` route using typed `PageProps`, a server action with
    `<Form>`/`useActionState`, and `loading`/`error`/`not-found` boundaries. Also
    fixes the starter's `instrumentation.ts` `onRequestError` signature.

- 4e84b34: Robustness, security, and observability hardening (all additive; one behavior change to error responses):

  - **Loader timeouts & abort propagation.** `defineLoader` accepts a per-loader
    `timeout` (ms), and `defineConfig({ loaderTimeout })` sets a global default. A
    loader that exceeds its timeout is aborted and rejects with `LoaderTimeoutError`
    (a page loader then renders `error.tsx`; a layout/group loader yields the usual
    error sentinel). The request's abort signal is now also threaded into loaders so
    a client disconnect cancels in-flight work. `LoaderTimeoutError` /
    `runWithLoaderTimeout` / `resolveLoaderTimeout` are exported from
    `solidstep/utils/loader-timeout`.
  - **Request-scoped loader context.** Loaders now receive a second argument,
    `{ locals, signal }` — the middleware-populated `event.locals` plus the combined
    abort signal. `Locals` (augmentable via declaration merging) and `LoaderContext`
    are exported from `solidstep/utils/loader`. Existing single-argument loaders are
    unaffected.
  - **Production error-message hardening (behavior change).** When a page loader
    throws during a soft navigation, the error envelope no longer leaks the raw
    error message to the client in production: it logs the message server-side under
    a generated `errorId` and returns a generic message plus that id. In development
    the full message is still sent.
  - **Rate-limit & body-size middleware.** New `rateLimit(...)`
    (`solidstep/utils/rate-limit`, backed by the active `CacheStore`) returns `429`
    with `Retry-After` once a key exceeds its window, and `bodyLimit(...)`
    (`solidstep/utils/body-limit`) returns `413` for oversized `Content-Length`.
    Both compose with `defineMiddleware`.
  - **Built-in request metrics.** `createMetricsInstrumentation(...)`
    (`solidstep/utils/metrics`) returns an `onResponseEnd` hook that emits one
    structured record per request (timing, status, route, render strategy, cache
    status) to the logger or a custom `sink`. The framework now records the render
    strategy on the request `metadata`.
  - **Surfaced cache failures.** Previously-silent `catch` paths in the cache
    stores now log through the framework logger (quiet by default), so cache
    corruption / unserializable values are diagnosable.

- 98c27dc: Add two quick-win features and fix a routing bug:

  - **Dynamic metadata files**: `app/robots.ts`, `app/sitemap.ts`, `app/manifest.ts`,
    and `app/llms.ts` convention files now serve `/robots.txt`, `/sitemap.xml`,
    `/manifest.webmanifest`, and `/llms.txt` with the correct `Content-Type`. New
    `solidstep/utils/metadata` export provides `sitemap()` and `robots()` body
    helpers.
  - **Loader caching**: `defineLoader` accepts `options.cache: { ttl, key }` to
    cache a loader's resolved data on the server (keyed per-URL by default).
  - **Fix**: `toPath` stripped the file extension twice using an unescaped-dot
    regex, mangling the route path of any root-level file whose name ends in
    `…ts`/`…js`/`…tsx`/`…jsx` (e.g. `robots.ts` resolved to `/rob`). It now strips
    the extension once.

- 2fa1f1b: `searchParams` now preserves repeated query keys as arrays, matching Next.js.
  Previously the framework built `searchParams` with `Object.fromEntries(...)`, which
  silently kept only the **last** value for a repeated key (`?tag=a&tag=b` →
  `{ tag: 'b' }`), dropping earlier values for filter/multi-select UIs. A new
  `parseSearchParams` helper now produces `{ tag: ['a', 'b'] }` consistently across
  page props, API-route handler context, the instrumentation request context, and
  the soft-navigation envelope.

  **Breaking (types):** the `searchParams` shape is now
  `Record<string, string | string[]>` everywhere (e.g. `PageProps['searchParams']`,
  the `route.ts` handler `ctx.searchParams`, and `useSearchParams()`). A single
  occurrence is still a `string`; only repeated keys become arrays. Code that
  assumed `searchParams[key]` was always a `string` may need a narrowing check.

  Also hardens the `csrf()` check: a malformed `Origin` or `Referer` header now
  fails the check closed (returning `{ success: false }`) instead of throwing an
  unhandled error that surfaced as a 500.

- 1eeb349: Add per-group loading and error boundaries for parallel routes. A `@group`
  directory can now include its own `loading.tsx` and/or `error.tsx`:

  - `error.tsx` isolates the slot — if the group's loader rejects or its component
    throws, only that slot renders its error page (receiving the `error` prop)
    while sibling slots and the page render normally.
  - `loading.tsx` is the `<Suspense>` fallback for a group with a deferred loader,
    shown until the slot's data streams in.

  Such routes render via `renderToStream` so the boundaries hydrate consistently;
  groups without a boundary or deferred loader are unchanged.

- c574590: Phase 2 — hardening + pluggable cache.

  - **Pluggable `CacheStore`**: the page-render and loader-data caches now run on a
    swappable backend. Built-in adapters: `MemoryCacheStore` (in-memory LRU, the
    default) and `FilesystemCacheStore` (persists entries to disk, node-server
    presets only). Select one via `defineConfig({ cache: { type: 'memory' | 'filesystem', ... } })`,
    or call `setCacheStore(store)` from `solidstep/utils/cache` inside your
    instrumentation `register()` hook to plug in an external store (e.g. Redis).
    New `solidstep/utils/cache-store` export carries the `CacheStore`/`CacheEntry`
    types and adapters for writing your own.
  - **Wall-clock TTL**: cache deadlines are now absolute (`Date.now()`-based)
    instead of monotonic, so they reason in real time and survive serialization.
  - **Stale-while-revalidate + tags**: `defineLoader` and page `options` accept
    `cache.swr` (serve stale while one background revalidation runs) and
    `cache.tags` (group invalidation via the new `invalidateTag(tag)`).
  - **Single-flight coalescing**: concurrent identical loader loads share one
    execution instead of each running the loader.
  - **Loader-error isolation**: a failing layout/group loader no longer takes down
    the whole render — it resolves to a serializable error sentinel so sibling
    content still renders. A failing page loader still renders the route `error.tsx`.

  **Breaking**: the `solidstep/utils/cache` data functions (`getCache`, `setCache`,
  `invalidateCache`, `clearAllCache`) are now **async** (return `Promise`) to
  support filesystem/external stores. `revalidatePath` is unchanged.

- 0ce6e1f: Phase 3 (final) — Partial Prerendering (`render: 'ppr'`).

  A PPR page serves a static prerendered **shell** instantly (like SSG) while its
  dynamic **holes** stay fresh per visit. Holes are marked with deferred loaders
  (`type: 'defer'`) on the page and/or parallel-route groups.

  - **Build**: the page is prerendered to a shell with each hole showing its
    `loading.tsx` Suspense fallback, written as a `.html` artifact (reusing the SSG
    prerender path).
  - **Runtime**: the static shell is served by the static layer; on the client each
    hole fetches its loader data from a new internal endpoint
    (`/__solidstep_loader`, validated against the matched route) and fills in. Holes
    reuse the loader cache (ttl/swr/tags).

  Tradeoff vs. deferred streaming on a `dynamic` page: PPR hole content is
  client-fetched (not in the initial HTML / not SEO-indexed) in exchange for a
  static, CDN-cacheable shell — ideal for personalized or fast-changing holes.

  Note: true single-response shell+stream splicing isn't feasible with Solid's
  `renderToStream` across the build/request boundary, so PPR is implemented as
  "static shell + client-fetched islands".

- c053977: Soft-navigation now integrates with `<Suspense>` for `defer` loaders, and the
  navigation-pending signal is wired up.

  - **Deferred loaders stream during soft navigation.** Previously a soft-nav to a
    route with a `type: 'defer'` loader blocked until the slow data resolved. Now
    the `/__solidstep_route` envelope leaves deferred holes unresolved; the client
    commits the shell instantly and fills each hole from `/__solidstep_loader`
    under `<Suspense fallback={loading.tsx}>` — so `defer` behaves the same on
    first load and on navigation (instant shell + per-hole loading state).
  - **Navigation pending UI.** `navigationPending` (from `solidstep/router`) is a
    reactive signal that is `true` while the next route's data is being fetched —
    use it to render a global loading indicator. Navigations commit immediately
    (via `batch`, not a transition) so deferred boundaries show their `loading.tsx`
    right away rather than being held back.
  - Prefetch (hover/viewport/eager on `<Link>`) and module warming from the
    previous release are unchanged; this adds the `<Suspense>`/pending-UI half of
    the story.

- 145aada: Internal hardening, new helpers, and docs (the only user-facing API change is the
  `onRequestError` signature):

  - **`onRequestError` now receives `(error, request, context)`.** The hook type was
    widened to include the request — matching `onRequest`/`onResponseEnd` and the
    arguments the framework already passed at runtime. A hook whose second parameter
    was typed `RequestContext` will now get a type error; rename it to `request` and
    read the context from the third parameter.
  - **Request metrics now include `cacheStatus`** (`'hit'` / `'miss'`) alongside
    `renderStrategy`, surfaced through `createMetricsInstrumentation`
    (`solidstep/utils/metrics`).
  - **New `solidstep/utils/sse`** — `sseResponse` (Server-Sent Events) and
    `streamResponse` helpers for streaming responses from `route.ts` handlers.
  - **Hardened the streamed loading-boundary swap** with a one-shot `location.reload()`
    fallback so a failed swap can't strand the loading shell, and routed the
    previously-silent ISR background-revalidation / prerender-manifest failures
    through the logger.
  - **Internal:** the `server.ts` request handler was decomposed — the page render
    now lives in `server/render-page.ts` over the `server/render.ts` engine (now
    unit-tested), and the render hot path was retyped with discriminated-union
    guards. No behavior change.
  - **Docs:** new Data Validation, Database & ORM, and Performance guides, plus an
    expanded request-lifecycle/architecture reference.

- 2fa1f1b: Add secure-by-default security helpers (all additive — existing APIs unchanged):

  - **`setSecureCookie(key, value, options?)`** (`solidstep/utils/cookies`) — sets a
    cookie with `httpOnly`, `sameSite: 'lax'`, `path: '/'`, and `secure` (in
    production) applied by default, so session/auth cookies can't accidentally ship
    without their protective flags. Any field is still overridable via `options`.
  - **`safeRedirect(url, { allowedHosts?, fallback? })`** and
    **`isSafeRedirectTarget(url, allowedHosts?)`** (`solidstep/utils/redirect`) —
    open-redirect-safe redirects for untrusted destinations (`?next=` params, form
    fields). Only same-site relative paths and allowlisted absolute hosts pass;
    off-site URLs, `javascript:`/`data:`, and protocol-relative `//host` are
    rejected (falling back to `'/'`).
  - **`createNoncePolicy(nonce)`** (`solidstep/utils/csp`) — a production-ready CSP
    preset: the strict baseline plus the per-request nonce on `script-src` /
    `style-src`, with no `'unsafe-inline'` / `'unsafe-eval'`. `createBasePolicy()`'s
    doc now clearly warns that it is a permissive dev convenience.
  - **`cors(..., { allowCredentials: true })`** (`solidstep/utils/cors`) — opt-in
    `Access-Control-Allow-Credentials: true` for trusted origins, enabling
    credentialed cross-origin requests.

- 0861a22: Phase 3 — rendering strategies: SSG and ISR.

  Pages can now declare a rendering strategy via the `render` page option:

  - `render: 'static'` (SSG) — prerendered to an HTML artifact at build time and
    served directly by the static layer with no per-request rendering.
  - `render: 'isr'` — prerendered at build time, then incrementally regenerated in
    the background after `revalidate` seconds (artifact + stale-while-revalidate,
    built on the Phase 2 cache). The stale artifact is served instantly while one
    coalesced background regeneration refreshes it.
  - `render: 'dynamic'` (default) — unchanged SSR on every request.

  Dynamic routes (`[id]`, `[...slug]`) using `static`/`isr` export
  `generateStaticParams` (typed via `GenerateStaticParams` from
  `solidstep/utils/prerender`) to enumerate which paths to prerender.

  Build-time prerendering runs from the existing Nitro `afterEach` hook: it boots
  the freshly built server in prerender mode, discovers `static`/`isr` routes,
  fetches each, and writes artifacts — static pages as `.html` into the public
  dir, ISR pages into the server dir plus a manifest the runtime seeds into the
  cache at boot. ISR cache tags (`options.cache.tags`) integrate with
  `invalidateTag`.

  PPR (partial prerendering — a static shell with streamed dynamic holes, built on
  the existing deferred-loader streaming) is the next step and is not included here.

### Patch Changes

- Widen the `vinxi` peer range to `^0.5.8`. vinxi 0.5.9–0.5.11 were published
  to npm without their TypeScript declarations (`dist/types` is missing from the
  tarballs), so the framework is now developed and typechecked against vinxi
  0.5.8. Any 0.5.x works at runtime; pin vinxi to 0.5.8 in your app if you want
  typed vinxi imports.
- Fix: a malformed `X-Server-Id` header (an id without a `#name` part) sent to
  the server-function endpoint now returns a 404 response instead of crashing
  the handler.
- e7a6bc0: Internal: extract the shared seroval serialization core (chunk framing,
  `serializeToStream`, `SerovalChunkReader`, and the plugin set) into
  `utils/serialize.ts`, de-duplicating it across the server and client
  server-action transports. No public API or behavior change.
- 2fa1f1b: Fix: the deferred/PPR hole-data endpoint (`/__solidstep_loader`) now serializes
  with **seroval** instead of plain JSON, matching the soft-navigation envelope and
  the first-load streamed path. Previously, deferred loader data fetched to fill a
  PPR hole (or a deferred loader on a soft navigation) silently lost non-JSON types
  — a loader returning `{ createdAt: new Date() }` round-tripped correctly on first
  load and full navigation but arrived as a string through a hole. Now `Date` /
  `Map` / `Set` / `BigInt` survive identically across every data path. The response
  `Content-Type` for this endpoint changes from `application/json` to
  `text/plain; charset=utf-8` accordingly.
- 825131f: Docs: clarify two capabilities that were mislabeled as "on the roadmap" — they're
  already available.

  - **Persistent/shared loader cache.** Loader data caching runs on the same pluggable
    `CacheStore` as the page cache, so configuring a filesystem or external (e.g. Redis)
    store via `defineConfig({ cache })` (or `setCacheStore` in instrumentation) makes loader
    data persistent and shared across processes — not just in-memory per-process.
  - **Per-group `defer`.** Parallel-route group (`@slot`) loaders support `type: 'defer'`,
    streaming their own `loading.tsx` on first load and fetching on client navigation,
    independently of the rest of the page. (Layout loaders remain sequential by design.)

  Adds confirming tests: loader caching against `FilesystemCacheStore` (including persistence
  across a fresh store instance) and a soft-navigation deferred-group e2e.

- 2fa1f1b: Internal refactor of `server.ts` (no public API change), continuing the
  decomposition:

  - The synchronous loading-placeholder swap — the inline `<script>` that replaces
    a streamed `loading.tsx` shell with the real page without wiping `<head>` — was
    extracted from `server.ts` into a dedicated, unit-tested `utils/loading-swap.ts`
    (`buildLoadingSwapScript`), so the gnarliest piece of inline render logic is now
    covered in isolation.
  - The render branches now use a single typed `pageEntry: RoutePageHandler`
    narrowed once after API-route dispatch, removing all fifteen
    `matched as RoutePageHandler` casts on the page-render hot path (compile-time
    only — no behavior change).

- 95fc97b: Security & correctness hardening of the SSR output:

  - **Page cache no longer caches by default.** Plain `dynamic` pages were being
    written to the page-render cache with no expiry and keyed by pathname only —
    so a page rendered once was served to everyone afterwards and query strings
    collided. Pages are now cached **only** when they opt in with a positive
    `options.cache.ttl` (matching the documented contract and the loader cache),
    and the cache key includes the query string.
  - **XSS hardening.** Loader data, route params, and metadata are now escaped
    before being written into the HTML/inline-script output: attribute values and
    text are HTML-escaped, and script-embedded payloads are escaped so a value
    containing `</script>` can no longer break out.
  - **Loader data uses seroval.** Loader-data hydration now uses the same seroval
    transport as server actions, so `Date`, `Map`, `Set`, and `BigInt` returned
    from a loader round-trip to the client intact instead of degrading.

- 845ae42: Refactor of `server.ts` (no public API change) plus one streaming bug fix. Pure
  HTML/inline-script generation moved to a new internal `utils/html.ts` and unit-tested
  (`generateHtmlHead`, `renderAssetsToHtml`, `serializeForScript`, `jsonForScript`,
  `hydrationScript`), with two dedupe helpers — `buildHydrationScript` (replacing
  six near-identical inline hydration-script emissions) and `buildHeadHtml` — plus
  `createBaseMeta`. The request `eventHandler` was decomposed: API-route handling
  extracted to `handleApiRoute`, and the page/SSR render scoped into a `renderPage`
  unit, so the handler reads as a thin request router.

  **Fix:** the streamed `loading.tsx` boundary is no longer client-hydrated — it is
  a transient server-rendered placeholder shown until the main content streams in
  and hydrates once. (It was previously hydrating the real page with empty loader
  data and racing the main hydration, intermittently leaving stale loader data on
  slow routes.) Verified by the full unit + e2e suite.

- 2fa1f1b: Organizational route groups (`(group)` folders that don't affect the URL) are now
  covered end-to-end. The feature already worked — the server manifest, client
  manifest, and typed-routes generation all strip `(group)` segments — but it was
  only lightly tested. Added a client-manifest unit test proving a `(group)`
  segment is stripped from the URL while a `layout.tsx` inside the group still wraps
  the route, plus a kitchen-sink `(marketing)` example with an e2e test, and
  expanded the routing docs to note that grouped layouts/boundaries apply.

All notable changes to the `solidstep` package are documented here. This project
adheres to [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Releases are managed
with [Changesets](https://github.com/changesets/changesets); on each release this
file is regenerated from the pending changesets in `.changeset/`.

> **Pre-1.0 notice.** While the package is `0.x`, minor versions may include
> breaking changes. See [`docs/roadmap.md`](../../docs/roadmap.md#stability--versioning-policy)
> for the versioning policy and the path to 1.0.

## Unreleased

The following changes are staged in `.changeset/` and will land in the next
release (collectively a **minor** bump from the current `0.4.2`).

### Added

- **Client-side (soft) navigation.** `<Link>` (`solidstep/link`) and `useNavigate`
  (`solidstep/router`) perform soft navigations without a full document reload:
  the target route's loader data and metadata are fetched in one request and the
  page re-renders reactively. `<Link>` renders a real `<a href>` (progressive-
  enhancement safe) with hover / viewport / eager `prefetch`. New `solidstep/router`
  API: `useNavigate`, `useRouter`, `usePathname`, `useSearchParams`, and a
  `navigationPending` signal. History (back/forward), scroll restoration, and
  `<title>`/metadata updates are handled automatically. Added an internal
  `/__solidstep_route` endpoint and an isomorphic client route matcher that mirrors
  the server route trie.
- **Suspense-integrated soft navigation.** Deferred (`type: 'defer'`) loaders now
  stream during soft navigation: the client commits the shell instantly and fills
  each hole from `/__solidstep_loader` under `<Suspense fallback={loading.tsx}>`,
  so `defer` behaves the same on first load and on navigation. The
  `navigationPending` signal is wired up for global loading indicators.
- **Partial Prerendering (`render: 'ppr'`).** A PPR page serves a static
  prerendered shell instantly while its dynamic holes (marked with `type: 'defer'`
  loaders on the page and/or parallel-route groups) stay fresh per visit. Holes are
  client-fetched from `/__solidstep_loader` and reuse the loader cache (ttl/swr/tags).
  (Implemented as "static shell + client-fetched islands"; hole content is not in
  the initial HTML.)
- **Rendering strategies: SSG and ISR.** Pages declare a strategy via the `render`
  page option: `render: 'static'` (prerendered to an HTML artifact at build time),
  `render: 'isr'` (prerendered then incrementally regenerated after `revalidate`
  seconds with stale-while-revalidate), or `render: 'dynamic'` (default SSR). Dynamic
  routes export `generateStaticParams` (typed via `GenerateStaticParams` from
  `solidstep/utils/prerender`) to enumerate paths to prerender. ISR cache tags
  integrate with `invalidateTag`.
- **Deferred page loaders (streaming SSR).** Mark a page loader `type: 'defer'` and
  its data is exposed as a Solid resource accessor read under `<Suspense>`. Such
  routes render via Solid's `renderToStream`: the shell (with `loading.tsx` as the
  Suspense fallback) streams immediately and the deferred data streams in afterward.
- **Per-group loading and error boundaries for parallel routes.** A `@group`
  directory can include its own `loading.tsx` (Suspense fallback for a deferred
  group loader) and/or `error.tsx` (isolates the slot — only that slot renders its
  error page while siblings and the page render normally).
- **Pluggable `CacheStore`.** The page-render and loader-data caches run on a
  swappable backend. Built-in adapters: `MemoryCacheStore` (in-memory LRU, default)
  and `FilesystemCacheStore` (disk persistence, node-server presets). Select via
  `defineConfig({ cache: { type, ... } })` or `setCacheStore(store)` in
  instrumentation `register()` for external stores (e.g. Redis). New
  `solidstep/utils/cache-store` export carries the `CacheStore`/`CacheEntry` types.
- **Stale-while-revalidate + cache tags.** `defineLoader` and page `options` accept
  `cache.swr` (serve stale during one background revalidation) and `cache.tags`
  (group invalidation via the new `invalidateTag(tag)`).
- **Single-flight coalescing.** Concurrent identical loader loads share one
  execution.
- **Dynamic metadata files.** `app/robots.ts`, `app/sitemap.ts`, `app/manifest.ts`,
  and `app/llms.ts` serve `/robots.txt`, `/sitemap.xml`, `/manifest.webmanifest`,
  and `/llms.txt` with correct `Content-Type`. New `solidstep/utils/metadata` export
  provides `sitemap()` and `robots()` body helpers.
- **Loader caching.** `defineLoader` accepts `options.cache: { ttl, key }` to cache
  resolved data on the server (keyed per-URL by default), running on the same
  pluggable `CacheStore` as the page cache — so a filesystem/external store makes
  loader data persistent and shared across processes.
- **Typed routes.** A build/dev Vite plugin scans `app/` and generates
  `solidstep-env.d.ts`, declaration-merging routes into the `Register` interface
  from `solidstep/router`. `<Link href>` and `useNavigate(to)` are type-checked
  against actual routes; `PageProps<'/blog/[slug]'>` / `RouteParams<'/blog/[slug]'>`
  give typed `routeParams`. Projects without generated types still compile.
- **Dev error overlay.** In development, an unhandled SSR error (no `error.tsx`), a
  server-action error, or a client hydration/navigation error shows a rich
  in-browser overlay (message + stack). Production behavior is unchanged (overlay
  tree-shaken out).

### Changed

- **Wall-clock TTL.** Cache deadlines are now absolute (`Date.now()`-based) instead
  of monotonic, so they reason in real time and survive serialization.
- **Loader-error isolation.** A failing layout/group loader no longer takes down the
  whole render — it resolves to a serializable error sentinel so sibling content
  still renders. A failing page loader still renders the route `error.tsx`.
- **In-place revalidation.** The root layout stays mounted across navigations;
  `revalidatePath` from a server action now updates mounted components in place
  (preserving local state like form inputs) by re-rendering reactively.
- **Removed the hand-rolled `diff-dom` module.** Server-action revalidation now
  re-renders reactively (`refreshRoute`) instead of patching the DOM.
- **Loader data uses seroval.** Loader-data hydration uses the same seroval
  transport as server actions, so `Date`, `Map`, `Set`, and `BigInt` returned from a
  loader round-trip to the client intact.

### Fixed

- **XSS hardening.** Loader data, route params, and metadata are HTML-escaped before
  being written into HTML / inline-script output, so a value containing `</script>`
  can no longer break out.
- **Page cache no longer caches by default.** Plain `dynamic` pages are now cached
  only when they opt in with a positive `options.cache.ttl`, and the cache key
  includes the query string (previously keyed by pathname only, with no expiry).
- **Metadata-file routing.** `toPath` stripped the file extension twice using an
  unescaped-dot regex, mangling the route path of any root-level file ending in
  `…ts`/`…js`/`…tsx`/`…jsx` (e.g. `robots.ts` resolved to `/rob`). It now strips the
  extension once.
- **Streaming loading boundary.** The streamed `loading.tsx` boundary is no longer
  client-hydrated — it is a transient server-rendered placeholder shown until the
  main content streams in and hydrates once (previously it hydrated the real page
  with empty loader data and raced the main hydration, intermittently leaving stale
  loader data on slow routes).

### Internal

- Refactored `server.ts` (no public API change): pure HTML / inline-script
  generation moved to a new internal `utils/html.ts` and unit-tested; the request
  `eventHandler` was decomposed (`handleApiRoute`, `renderPage`) so it reads as a
  thin request router.
- Extracted the shared seroval serialization core (chunk framing,
  `serializeToStream`, `SerovalChunkReader`, plugin set) into `utils/serialize.ts`,
  de-duplicating it across the server and client server-action transports.

### Breaking

- The `solidstep/utils/cache` data functions (`getCache`, `setCache`,
  `invalidateCache`, `clearAllCache`) are now **async** (return `Promise`) to support
  filesystem/external stores. `revalidatePath` is unchanged.

---

_No tagged releases have been published from this committed changelog yet. Prior
`0.x` versions (current: `0.4.2`) predate the Changesets-managed changelog; see the
git history for that earlier record._
