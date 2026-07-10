# @varlabs/create-solidstep

## 1.0.0

### Major Changes

- 9972325: Scaffolded apps now declare and require Node.js `>=22.19.0`, matching `solidstep`'s new minimum supported Node version.

## 0.3.3

### Patch Changes

- 370e641: Scaffolded apps now include an `AGENTS.md` that teaches AI coding agents SolidStep's conventions: routing and special files, loaders, server actions and forms, rendering/caching options, security middleware, an import cheat sheet, and common SolidJS pitfalls.

## 0.3.2

### Patch Changes

- a4fa4a8: Add the package's first automated test suite: a Vitest test that scaffolds
  a real app via `bin/main.ts` into a temp directory and asserts the expected
  files exist, `package.json` has the right dependencies, and the generated
  `app/middleware.ts` is syntactically valid TypeScript. Wired into `pnpm test`
  at the repo root.

## 0.3.1

### Patch Changes

- 511a1b6: Harden the scaffolded `app/middleware.ts` template:

  - `event.locals` is now merged rather than clobbered when the security
    middleware sets `cspNonce`, so it no longer wipes out fields set by
    earlier middleware in the chain.
  - Added `bodyLimit`/`rateLimit` with conservative defaults (1 MB body cap,
    100 req/min per IP), running first so oversized/abusive requests
    short-circuit before the CSP/CSRF/CORS work.
  - `trustedOrigins` now reads from a `TRUSTED_ORIGINS` env var
    (comma-separated), falling back to the placeholder example origins, with
    an EDIT-ME comment. A new `.env.example` documents the variable, and
    `.env`/`.env.local` are gitignored.

## 0.3.0

### Minor Changes

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

All notable changes to the `@varlabs/create-solidstep` CLI are documented here.
This project adheres to [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Releases are
managed with [Changesets](https://github.com/changesets/changesets); on each
release this file is regenerated from the pending changesets in `.changeset/`.

> **Pre-1.0 notice.** While the package is `0.x`, minor versions may include
> breaking changes. See [`docs/roadmap.md`](../../docs/roadmap.md#stability--versioning-policy).

## Unreleased

The following change is staged in `.changeset/` and will land in the next release
(a **minor** bump from the current `0.2.0`).

### Changed

- **Richer starter template.** The default `create-solidstep` template is now a
  guided tour: `<Link>` navigation with a pending indicator, a loader page, a static
  page, a dynamic `[slug]` route using typed `PageProps`, a server action with
  `<Form>` / `useActionState`, and `loading` / `error` / `not-found` boundaries.

### Fixed

- Corrected the starter's `instrumentation.ts` `onRequestError` signature.

---

_No tagged releases have been published from this committed changelog yet. Prior
`0.x` versions (current: `0.2.0`) predate the Changesets-managed changelog; see the
git history for that earlier record._
