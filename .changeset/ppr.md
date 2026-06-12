---
"solidstep": minor
---

Phase 3 (final) — Partial Prerendering (`render: 'ppr'`).

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
