# solidstep

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
