---
'solidstep': minor
---

Feat/Breaking: `options.hydration` gains real behavior:

- **`fetchPriority`** now sets the `fetchpriority` attribute on the
  hydration `<script type="module">` (previously typed but ignored).
- **`disable`** now ships **true zero framework JS** for a plain,
  synchronously rendered page: no hydration script, no client-manifest
  script, no module-preload links. `<Link>`/`<Form>` degrade to native
  browser behavior (full loads, no-JS form submissions) — both already work
  server-side. It's incompatible with `render: 'ppr'`, a deferred loader, or
  a sibling `loading.tsx` (all three need the client runtime); combining
  them logs a warning and `disable` is ignored for that render. If the
  render throws and falls back to `error.tsx`, normal hydration resumes.

**Breaking (type-level):** `options.hydration.blockRender` has been
removed. It was typed but had no defined semantics and was never read by
the render pipeline.
