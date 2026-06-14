# Roadmap

Where SolidStep is today, what's stable, and where it's heading. This page is the
honest answer to "is it safe to adopt?" for a pre-1.0 framework.

For the concrete, version-by-version record see the changelogs:
[`solidstep`](../packages/solidstep/CHANGELOG.md) and
[`@varlabs/create-solidstep`](../packages/create-solidstep/CHANGELOG.md).

## Stability & versioning policy

SolidStep is **pre-1.0**. The framework (`solidstep`) is at `0.4.2` and the
scaffolding CLI (`@varlabs/create-solidstep`) is at `0.2.0`.

- **Semantic Versioning with a pre-1.0 caveat.** We follow
  [SemVer](https://semver.org/), but per its `0.x` rules **minor versions may
  include breaking changes** until `1.0.0`. Patch releases are always
  backward-compatible bug fixes and docs. We call out every breaking change in the
  changelog under a **Breaking** heading (for example, the cache data functions
  becoming `async`).
- **Releases are managed with [Changesets](https://github.com/changesets/changesets).**
  Each change ships with a changeset (`patch` / `minor` / `major`) describing it; on
  release, Changesets bumps the affected package versions and regenerates the
  per-package `CHANGELOG.md`. The committed changelogs carry an **Unreleased** section
  summarizing the pending changesets so you can see what's coming before it ships.
- **What `1.0` means.** `1.0` is where we commit to stable public APIs under normal
  SemVer (breaking changes only in majors). Until then, pin a version and read the
  changelog before upgrading.

## What's stable today

These capabilities are implemented, documented, and covered by the test suite. They
are the feature set you can build on right now (see the linked guides for details).

- **Rendering strategies** — per-page `render` option:
  - **SSR (`dynamic`, default)** — rendered on every request.
  - **SSG (`static`)** — prerendered to an HTML artifact at build time.
  - **ISR (`isr`)** — prerendered, then incrementally regenerated in the background
    after `revalidate` seconds (stale-while-revalidate).
  - **PPR (`ppr`)** — a static prerendered shell served instantly, with dynamic holes
    filled per visit.
  - Dynamic routes use `generateStaticParams` to enumerate prerendered paths.
  See [Rendering Strategies](./rendering.md).
- **Streaming SSR & deferred loaders** — mark a page or parallel-group loader
  `type: 'defer'` to stream its shell immediately (with `loading.tsx` as the
  `<Suspense>` fallback) and stream the data in afterward. Per-group `loading.tsx` /
  `error.tsx` boundaries isolate parallel-route slots. See
  [Data Loading](./data-loading.md) and [Routing](./routing.md).
- **Client-side (soft) navigation** — `<Link>` and `useNavigate` navigate without a
  full reload, fetching the route's loader data + metadata in one request and
  re-rendering reactively. Includes prefetch (hover/viewport/eager), scroll
  restoration, history, automatic `<title>`/metadata updates, and a
  `navigationPending` signal. Router API: `useNavigate`, `useRouter`, `usePathname`,
  `useSearchParams`. See [Routing](./routing.md) and [Utilities](./utilities.md).
- **Server actions & forms** — server functions with `<Form>`, `useActionState`, and
  `useFormStatus`, progressive-enhancement safe, with seroval serialization so
  `Date` / `Map` / `Set` / `BigInt` round-trip intact. Mutations can revalidate the
  current route's loader data in place via `revalidatePath`. See
  [Server Actions & Forms](./server-actions-and-forms.md).
- **Typed routes** — a generated `solidstep-env.d.ts` type-checks `<Link href>` and
  `useNavigate(to)` against your real routes and provides typed
  `PageProps` / `RouteParams`. See [Getting Started](./getting-started.md).
- **Pluggable caching** — a swappable `CacheStore` (in-memory LRU default,
  filesystem, or external such as Redis) powering both the page-render and loader
  caches, with wall-clock TTL, stale-while-revalidate, cache tags, single-flight
  coalescing, `revalidatePath`, and `invalidateTag`. See [Caching](./caching.md).
- **Metadata & metadata files** — `generateMeta` / `meta()` for SEO metadata, plus
  dynamic `robots.ts`, `sitemap.ts`, `manifest.ts`, and `llms.ts` convention files.
  See [Metadata](./metadata.md) and [Metadata Files](./metadata-files.md).
- **Middleware** — composable request/response interceptors via `defineMiddleware`.
  See [Middleware](./middleware.md).
- **Security utilities** — cookies, CORS, CSP (with nonce), CSRF, redirects, error
  handling, and `client-only` / `server-only` boundaries. See [Security](./security.md).
- **Instrumentation** — observability hooks (including OpenTelemetry) and structured
  logging. See [Instrumentation](./instrumentation.md).
- **API routes** — REST endpoints with `route.ts`. See [API Routes](./api-routes.md).
- **Tooling** — a dev error overlay, `@varlabs/create-solidstep` scaffolding with a
  guided starter, and deployment via Nitro presets. See [Deployment](./deployment.md).

## On the path to 1.0

Before `1.0`, the focus is hardening and maintainability rather than new surface
area. These are committed directions (tracked internally), not new user-facing
features:

- **Decompose the render/server core.** Split the large `server.ts` into cohesive
  modules (route manifest, data endpoints, ISR, the render engine, response builders)
  with the orchestrator kept thin, and unit-test the isolated pieces.
- **Tighten typing in the render/server layer.** Give the internal `render()` a
  discriminated-union return type and a typed `PageOptions`, replacing the remaining
  `any` casts on the hot path (compile-time only — no behavior change).
- **Harden the synchronous loading-placeholder swap** and surface today's
  intentionally-silent failure paths through the logger at `debug`/`warn` (quiet in
  production) so misconfiguration is visible.
- **Expand contributor & user docs** — a dedicated testing guide (loaders, actions,
  components, e2e) and a deeper request-lifecycle/architecture reference, plus JSDoc
  on the client/build internals.
- **Broaden test coverage** of the isolated pipeline and the `client-only` /
  `server-only` and prefetch boundaries.

## Future / under consideration

These are ideas we may pursue after the path-to-1.0 work. **They are not committed,
not scheduled, and may change or be dropped** — listed here for transparency, not as
promises.

- **Deferred *layout* loaders.** `defer` is page- and group-scoped today; layout
  loaders are always awaited. Supporting deferred layouts would unlock more granular
  streaming.
- **Request-scoped `locals` / context.** A typed request context threaded from
  middleware through to loaders and actions (today `locals` only carries the CSP
  nonce).
- **View Transitions API** integration in the soft-navigation router for animated
  page transitions.
- **Schema-validated server actions** — type-safe action input validation layered on
  the existing `<Form>` / `useActionState`.
- **Image & font optimization** components.
- **i18n routing** convention.

Have a use case that depends on one of these? Open an issue on
[GitHub](https://github.com/HamzaKV/solidstep) — interest helps us prioritize.
