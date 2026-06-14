# @varlabs/create-solidstep

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
