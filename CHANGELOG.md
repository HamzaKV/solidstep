# Changelog

This is the top-level changelog for the SolidStep monorepo. SolidStep is released
as two packages, each with its own detailed changelog:

- [`solidstep`](./packages/solidstep/CHANGELOG.md) — the framework (current: `0.4.2`).
- [`@varlabs/create-solidstep`](./packages/create-solidstep/CHANGELOG.md) — the
  project scaffolding CLI (current: `0.2.0`).

Releases are managed with [Changesets](https://github.com/changesets/changesets)
and follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) +
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). See
[`docs/roadmap.md`](./docs/roadmap.md) for the pre-1.0 stability and versioning
policy.

> **Pre-1.0 notice.** While packages are `0.x`, minor versions may include breaking
> changes.

## Unreleased

Changes staged in `.changeset/` for the next release. The next `solidstep` release
is a **minor** bump (from `0.4.2`); the next `@varlabs/create-solidstep` release is a
**minor** bump (from `0.2.0`). See each package changelog for the full, itemized list.

### `solidstep`

- **Client-side (soft) navigation** — `<Link>`, `useNavigate`, `useRouter`,
  `usePathname`, `useSearchParams`, `navigationPending`; prefetch (hover/viewport/
  eager), scroll restoration, history, and reactive in-place revalidation. Replaces
  the removed `diff-dom` patching module.
- **Rendering strategies** — SSG (`render: 'static'`), ISR (`render: 'isr'`), and
  Partial Prerendering (`render: 'ppr'`), plus deferred page/group loaders
  (`type: 'defer'`) over streaming SSR with per-group `loading.tsx` / `error.tsx`
  boundaries.
- **Pluggable caching** — swappable `CacheStore` (memory / filesystem / external),
  wall-clock TTL, stale-while-revalidate, cache tags + `invalidateTag`, single-flight
  coalescing, and persistent/shared loader caching.
- **Dynamic metadata files** — `robots.ts`, `sitemap.ts`, `manifest.ts`, `llms.ts`.
- **Typed routes** — generated `solidstep-env.d.ts` type-checks `<Link>` /
  `useNavigate` and typed `PageProps` / `RouteParams`.
- **Dev error overlay**, **XSS hardening**, **seroval-based loader serialization**,
  and an internal `server.ts` / serialization refactor.
- **Breaking:** `solidstep/utils/cache` data functions (`getCache`, `setCache`,
  `invalidateCache`, `clearAllCache`) are now async.

### `@varlabs/create-solidstep`

- **Richer starter template** demonstrating routing, loaders, server actions, typed
  `PageProps`, and `loading` / `error` / `not-found` boundaries; fixed the starter's
  `onRequestError` signature.

---

_No tagged releases have been cut from this committed changelog yet. Versions prior
to the current `solidstep@0.4.2` / `@varlabs/create-solidstep@0.2.0` predate the
committed changelogs and are recorded in the git history._
