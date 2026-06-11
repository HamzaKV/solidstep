# Rendering Strategies (SSG / ISR / Dynamic)

[← Back to docs index](./README.md)

Every page chooses how it is rendered via the `render` field of its exported
`options`. The default is dynamic server rendering; opt into static generation
(SSG) or incremental static regeneration (ISR) per route.

```tsx
import { options as defineOptions } from 'solidstep/utils/options';

export const options = defineOptions({
  render: 'static', // 'static' | 'isr' | 'dynamic'  (default: 'dynamic')
});
```

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

## Coming next: PPR

Partial prerendering — a static shell served instantly with dynamic "holes"
streamed in — is the planned next step, built on the existing deferred-loader
streaming (`type: 'defer'` + `<Suspense>`). Not yet available.

## Related

- [Caching](./caching.md) — the cache store, SWR, and tags that ISR builds on.
- [Data Loading](./data-loading.md) — loaders feed prerendered and dynamic pages alike.
- [Deployment](./deployment.md) — building and serving the output.
