# Rendering Strategies (Dynamic / SSG / ISR / PPR)

[← Back to docs index](./README.md)

Every page chooses how it is rendered via the `render` field of its exported
`options`. The default is dynamic server rendering; opt into static generation
(SSG), incremental static regeneration (ISR), or partial prerendering (PPR) per
route.

```tsx
import { options as defineOptions } from 'solidstep/utils/options';

export const options = defineOptions({
  render: 'static', // 'static' | 'isr' | 'dynamic' | 'ppr'  (default: 'dynamic')
});
```

## Choosing a strategy

| Strategy | Rendered | Dynamic content | In initial HTML? (SEO) | Best for |
|---|---|---|---|---|
| `dynamic` | every request | server-rendered inline | ✅ yes | always-fresh pages |
| `dynamic` + `defer` loaders | every request (streamed) | **server-streamed holes** | ✅ yes (streamed) | fresh pages with slow parts you want crawlable |
| `static` | build time | none (fully static) | ✅ yes | content that rarely changes |
| `isr` | build time + background revalidate | none (refreshed on a timer) | ✅ yes | static-ish content with periodic updates |
| `ppr` | build-time shell + client-filled holes | **client-fetched islands** | ❌ holes not in initial HTML | a CDN-cacheable shell with personalized/dynamic islands |

The two ways to mix static and dynamic are deliberate opposites: **`defer`
loaders stream hole content into the HTML** (crawlable, one round-trip, server
re-renders the shell each request), while **`ppr` serves a build-time static
shell** (CDN-cacheable, zero per-request shell render) and **fills holes on the
client** (an extra fetch, not in the initial HTML). See
[SEO and dynamic holes](#seo-and-dynamic-holes).

## `dynamic` (default)

Server-rendered on every request (SSR). No change from prior behavior.

## `static` (SSG)

The page is prerendered to an HTML artifact **at build time** and served directly
by the static layer — no per-request rendering.

```tsx
export const options = defineOptions({ render: 'static' });
```

Build output: `.output/public/<route>/index.html`. In dev, static pages render
dynamically (no build step), so you always see fresh output while developing.

## `isr` (Incremental Static Regeneration)

The page is prerendered at build time, then regenerated in the background after
`revalidate` seconds — an artifact plus stale-while-revalidate. A request after
the window serves the stale artifact **instantly** and triggers one coalesced
background regeneration that refreshes the cache; subsequent requests see the new
version.

```tsx
export const options = defineOptions({
  render: 'isr',
  revalidate: 60, // seconds; defaults to 60 if omitted
});
```

Build artifacts are written into the server output and a `prerender-manifest.json`
the runtime seeds into the cache at boot, so the first request after a (re)start
is already warm. ISR runs on the active [`CacheStore`](./caching.md#pluggable-cache-stores),
and `options.cache.tags` integrate with `invalidateTag` for on-demand purges.

## Dynamic routes: `generateStaticParams`

A dynamic route (`[id]`, `[...slug]`) using `static`/`isr` must export
`generateStaticParams` to enumerate the paths to prerender. Each entry maps param
names to values (a string, or a string array for catch-all segments).

```tsx
import { options as defineOptions } from 'solidstep/utils/options';
import type { GenerateStaticParams } from 'solidstep/utils/prerender';

export const options = defineOptions({ render: 'static' });

export const generateStaticParams: GenerateStaticParams = async () => [
  { id: '1' },
  { id: '2' },
];

export default function ProductPage(props: { routeParams: { id: string } }) {
  return <p>id:{props.routeParams.id}</p>;
}
```

Paths not enumerated by `generateStaticParams` are not prerendered; for `static`
routes a request to such a path falls through to dynamic rendering.

## How build-time prerendering works

During `vinxi build`, after Nitro finishes, SolidStep boots the freshly built
server in a prerender mode, discovers which routes are `static`/`isr` (evaluating
`generateStaticParams` for dynamic ones), fetches each route, and writes the
artifacts. The step is best-effort: a failure logs a warning but never fails the
build.

## `ppr` (Partial Prerendering)

A PPR page serves a **static prerendered shell** instantly (like SSG) with
**dynamic "holes"** that stay fresh per visit. Mark the holes with deferred
loaders (`type: 'defer'`) — on the page itself, a layout, and/or on
parallel-route groups.

```tsx
export const options = defineOptions({ render: 'ppr' });
```

At build time the page is prerendered to a shell with each hole showing its
`loading.tsx` Suspense fallback (written to `.output/public/<route>/index.html`).
On the client, each hole fetches its loader data from a per-request endpoint and
fills in — so the shell is static/CDN-cacheable while the holes are dynamic.

```tsx
// app/feed/page.tsx — static shell
export const options = defineOptions({ render: 'ppr' });
export default function Feed() {
  return <h1>Latest</h1>; // static
}

// app/feed/@live/page.tsx — a dynamic hole (deferred loader)
export const loader = defineLoader(async () => getLiveItems(), { type: 'defer' });
export default function Live(props: { loaderData: () => Item[] | undefined }) {
  return <ul>{/* props.loaderData() — filled on the client */}</ul>;
}
// app/feed/@live/loading.tsx — the fallback baked into the prerendered shell
```

**Tradeoff vs. `defer` streaming:** PPR serves a build-time static shell and
fills holes **on the client**, so hole content is *not* in the initial HTML — the
right tradeoff for personalized/frequently-changing holes whose shell you want
served statically. If the hole content must be crawlable, use `defer` streaming
instead (see [SEO and dynamic holes](#seo-and-dynamic-holes)). Dynamic PPR routes
(`[id]`) use `generateStaticParams` to prerender one shell per path; holes read
the real params from the URL at request time.

## SEO and dynamic holes

If a page mixes static and dynamic content and the **dynamic part must be
crawlable**, prefer `defer` streaming over `ppr`:

- **`defer` streaming** (`render: 'dynamic'` + a `type: 'defer'` loader)
  server-renders the shell and **streams the resolved hole content into the same
  HTML response** — Solid emits each hole as a `<template>` plus a `$df(...)` swap
  script. The content is in the initial response (one round-trip) and JS-executing
  crawlers (e.g. Googlebot) render it. The cost is that the shell is re-rendered
  per request. Working demo: `examples/kitchen-sink/app/deferred`
  (`tests/deferred.spec.ts`). (An `isr` page with a `defer` loader is also
  crawlable, but its holes are resolved when the artifact is regenerated and
  served from cache between revalidations — not streamed fresh per request.)
- **`ppr`** keeps the shell static/CDN-cacheable but fills holes with a **client
  fetch after load**, so hole content is not in the initial HTML. Demo:
  `examples/kitchen-sink/app/ppr`.

There is no "static CDN shell **and** server-streamed holes" mode: Solid must
append streamed hole chunks before `</html>`, so such a page can't be served as a
static file and would re-render the full tree per request anyway — i.e. it would
be `defer` streaming with extra steps. Choose based on whether you need a
CDN-static shell (`ppr`) or crawlable holes (`defer`).

## Client hydration options

Every page's `options` also accepts a `hydration` object controlling the
client bootstrap:

```tsx
export const options = defineOptions({
  hydration: {
    disable: true, // ship zero framework JS for this route
    fetchPriority: 'high', // 'high' | 'low' | 'auto' — hint on the hydration script
  },
});
```

- **`fetchPriority`** sets the `fetchpriority` attribute on the hydration
  `<script type="module">`, letting the browser prioritize (or deprioritize)
  fetching it relative to other resources.
- **`disable`** ships **true zero framework JS** for a plain, synchronously
  rendered page: no hydration script, no client-manifest script, no
  module-preload links. `<Link>` and `<Form>` degrade to native browser
  behavior (full page loads, no-JS form submissions) — both already work
  server-side, so a fully static page (a marketing/content page with no
  interactivity) needs no client bundle at all.

  `disable` only applies to a plain `dynamic` render that completes
  successfully. It is **incompatible** with `render: 'ppr'`, a deferred
  (`type: 'defer'`) loader, or a sibling `loading.tsx` — all three need the
  client runtime to fill holes or swap content in. Combining them logs a
  warning and `disable` is ignored for that render. If the page's render
  throws and falls back to `error.tsx`, normal hydration resumes for the
  error page.

## Related

- [Caching](./caching.md) — the cache store, SWR, and tags that ISR builds on.
- [Data Loading](./data-loading.md) — loaders feed prerendered and dynamic pages alike.
- [Deployment](./deployment.md) — building and serving the output.
