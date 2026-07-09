# Performance Tuning

[← Back to docs index](./README.md)

Practical levers for making a SolidStep app fast, roughly in order of impact.

## Pick the right rendering strategy

The biggest win is not rendering on every request when you don't have to. Per-page
`options.render` (see [Rendering](./rendering.md)):

- **`static` (SSG)** — content that's the same for everyone; zero per-request cost.
- **`isr`** — mostly-static content that changes occasionally; served from cache,
  regenerated in the background after `revalidate` seconds.
- **`ppr`** — a static shell with a few dynamic holes; the shell is CDN-cacheable.
- **`dynamic`** (default) — truly per-request pages.

Prefer `static`/`isr`/`ppr` wherever the data isn't strictly per-request.

## Stream slow, non-critical data

Mark a page or parallel-group loader `type: 'defer'` so the shell streams
immediately and the slow data fills in under `<Suspense>` (its `loading.tsx`),
instead of blocking time-to-first-byte. Keep above-the-fold/SEO-critical data
**sequential** and defer the rest. See [Data Loading](./data-loading.md).

## Cache loader data and pages

- **Loader cache** — `defineLoader(fn, { cache: { ttl, swr, tags } })` memoizes a
  loader's result on the active `CacheStore`. Use `swr` to serve instantly while
  revalidating; use `tags` + `invalidateTag` to bust groups after a write.
- **Page cache** — `options.cache` caches the rendered HTML for a dynamic page.
- Single-flight coalescing means concurrent identical loads run the loader once.

Choose `ttl`/`swr` by how stale the data may be: short `ttl` + generous `swr` keeps
responses fast while bounding staleness. See [Caching](./caching.md).

On memory-constrained runtimes, bound the in-memory store:
`defineConfig({ cache: { type: 'memory', maxEntries, maxBytes } })`, or use the
filesystem/an external (Redis) store.

## Bound slow loaders

Set a global or per-loader timeout so one slow upstream can't pin a response:
`defineConfig({ loaderTimeout })` or `defineLoader(fn, { timeout })`. The request's
abort signal is also passed to loaders — forward `context.signal` to `fetch`/DB
calls so a client disconnect cancels in-flight work. See
[Data Loading](./data-loading.md#loader-timeouts).

## Measure with request metrics

Wire up [`createMetricsInstrumentation`](./instrumentation.md#built-in-request-metrics)
to get a per-request record with `durationMs`, `routePath`, `statusCode`,
`renderStrategy`, and `cacheStatus`. Use it to find slow routes and low
cache-hit rates before optimizing — measure, don't guess:

```ts
// app/instrumentation.ts
import { defineInstrumentation } from 'solidstep/utils/instrumentation';
import { createMetricsInstrumentation } from 'solidstep/utils/metrics';

export default defineInstrumentation({
  ...createMetricsInstrumentation({
    sink: (r) => {
      if (r.durationMs > 500) console.warn('slow route', r);
    },
  }),
});
```

For finer detail, record timings around individual loaders/queries in
`context.metadata` from the instrumentation hooks (or your tracing SDK).

## Analyze the client bundle

Each route's page/layout is a separate code-split chunk, and the production build
prints per-chunk sizes. To inspect what's in a chunk, add a visualizer via the
Vite config in `defineConfig({ vite })`:

```ts
import { defineConfig } from 'solidstep';
import { visualizer } from 'rollup-plugin-visualizer';

export default defineConfig({
  vite: () => ({ plugins: [visualizer({ filename: 'stats.html' })] }),
});
```

Keep heavy, client-only widgets out of the server/critical path with
[`clientOnly`](./utilities.md), and avoid importing large libraries into shared
layouts (they end up in every chunk).

## Prefetch on intent

`<Link prefetch="hover">` (default) warms the target route's data + modules on
hover/focus so navigation feels instant; use `prefetch="viewport"` for links that
scroll into view. See [Routing](./routing.md).

## Benchmarking the framework

`scripts/bench.mjs` at the repo root is a zero-dependency load generator for
before/after comparisons on one machine (not absolute-ceiling numbers):

```bash
pnpm --filter solidstep build
pnpm --filter kitchen-sink build
node examples/kitchen-sink/.output/server/index.mjs &
pnpm bench
```

It hits a fixed set of kitchen-sink routes (`/`, `/about`, `/slow`, `/deferred`,
`/isr`, `/ppr`, `/__solidstep_route`) with a warmup phase, then reports RPS and
p50/p95/p99 latency + TTFB per route. Override `BASE_URL`, `DURATION_MS`,
`CONCURRENCY`, or `WARMUP` via env vars. Run it 2-3 times and compare medians —
a single run is noisy.

## Related

- [Rendering](./rendering.md) — SSG / ISR / PPR / dynamic.
- [Caching](./caching.md) — loader & page caches, SWR, tags, stores.
- [Instrumentation](./instrumentation.md) — metrics and tracing hooks.
- [Data Loading](./data-loading.md) — deferred loaders, timeouts, cancellation.
