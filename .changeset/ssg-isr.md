---
"solidstep": minor
---

Phase 3 — rendering strategies: SSG and ISR.

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
