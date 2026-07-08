# Caching

[← Back to docs index](./README.md)

## Page Options

Configure page-level caching by exporting an `options` object from a `page.tsx`:

```tsx
export const options = {
  cache: {
    ttl: 60000,      // Cache for 60 seconds
    swr: 300000,     // ...then serve stale for up to 5 more minutes
    tags: ['posts'], // Group-invalidate via invalidateTag('posts')
  },
  responseHeaders: { // Custom headers for pages
    'X-Custom-Header': 'MyValue',
    'Cache-Control': 'public, max-age=60', // Client-side caching
  },
};
```

- Regarding caching, setting `ttl` to `0` or omitting it will disable caching for that page.
  - Setting a positive integer value will cache the page for that duration in milliseconds. TTL is wall-clock (`Date.now()`-based).
  - `swr` adds a stale-while-revalidate window (in ms) *after* `ttl` during which the cached render is still served (stale).
  - `tags` associate the cached render with one or more tags for group invalidation via `invalidateTag`.
  - Invalidation of cached pages can be done using the `invalidateCache`, `invalidateTag`, and `revalidatePath` utilities.
- The `responseHeaders` option allows you to set custom HTTP headers for the page response.

The same `cache` options (`ttl`, `swr`, `tags`, plus `key`) are accepted by
`defineLoader(loader, { cache: { ... } })` to cache a loader's resolved data.
Loader caching adds **single-flight coalescing** (concurrent identical loads run
the loader once) and **stale-while-revalidate** (the stale value is served
immediately while one background revalidation refreshes it).

## Cache (Server-Side)

- Every page can be cached by setting the `options.cache` property in the page.
- You can also manually invalidate the cache for specific routes.
- Invalidation can be done in two ways:

1. Using the `invalidateCache` utility to only invalidate paths.
```tsx
import { invalidateCache } from 'solidstep/utils/cache';

const action = async () => {
    'use server';

    ...

    // Invalidate cache after data mutation
    await invalidateCache('/some-route');

    ...

    return { success: true };
};
```

2. Using the `revalidatePath` utility from within a server action. It sets a response header that the client router reads: when the revalidated path matches the route the user is currently on, the router automatically re-fetches that route's loader data + metadata and updates the page **in place** (no full reload, no component remount — local component state is preserved). This is the "single-flight mutation" flow: the mutation and the refreshed data round-trip together. To trigger the same in-place refresh manually (outside a server action), call `useRouter().refresh()` — see [Client Navigation](./routing.md#revalidating-after-a-mutation).
```tsx
import { revalidatePath } from 'solidstep/utils/cache';

const action = async () => {
    'use server';

    ...

    // Revalidate path after data mutation
    await revalidatePath('/some-route');

    ...

    return { success: true };
};
```

3. Using the `invalidateTag` utility to invalidate every page/loader entry that
   was written with a matching tag.
```tsx
import { invalidateTag } from 'solidstep/utils/cache';

const action = async () => {
    'use server';

    // Drop every cache entry tagged 'posts' (pages and loaders).
    await invalidateTag('posts');

    return { success: true };
};
```

> The cache data functions (`getCache`, `setCache`, `invalidateCache`,
> `invalidateTag`, `clearAllCache`) are **async** — always `await` them.

> **Negative caching.** `getCache` returns `null` for both a miss and a value
> cached as `null`. To cache "not found" results (and tell the two apart), use
> `getCacheResult(key)`, which returns `{ hit, value }` — `hit` is `true` even
> when the cached `value` is `null`.

## On-demand revalidation endpoint

Set `SOLIDSTEP_REVALIDATE_TOKEN` to expose an HTTP endpoint a CMS webhook or
deploy hook can call to invalidate the cache without a redeploy — the endpoint
is **only reachable when the env var is set**; otherwise it 404s like any
other unmatched route (no separate flag needed).

```bash
curl -X POST https://your-app.example.com/__solidstep_revalidate \
  -H "Authorization: Bearer $SOLIDSTEP_REVALIDATE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"path": "/blog/my-post"}'
```

- `{ "path": "/some/route" }` — invalidates that path's page-render cache
  (published **and** preview namespaces) and, if it's an `isr` route, its ISR
  artifact. It does **not** reach the loader-data cache (keyed by manifest
  path, not URL) — use `{ tag }` for that. The ISR-vs-page-cache split is
  intentional key design, not a bug: the ISR artifact key is the bare
  pathname (ISR doesn't vary by query string), while the page-render cache
  key includes the search string. So `{ "path": "/blog/my-post" }` clears
  both, but `{ "path": "/blog/my-post?ref=twitter" }` only reaches the
  page-render cache's entry for that exact query — pass the bare path to also
  clear the route's ISR artifact.
- `{ "tag": "some-tag" }` — calls `invalidateTag`, dropping every page/loader
  cache entry written with that tag (same as calling it from a server action).
- Missing/wrong token → `401` (constant-time compared, so it can't be
  timing-attacked). Any method other than `POST` → `405`. A body with neither
  `path` nor `tag` → `400`.

## Preview mode

Set `SOLIDSTEP_PREVIEW_SECRET` to let editors preview unpublished content
without waiting for ISR/page-cache to expire. `enablePreview()` sets an
HMAC-signed cookie (via `node:crypto`, no dependency); while it's present and
valid, the current visitor's requests read from and write to a cache
namespace **isolated** from the published one, for:

- the ISR short-circuit (`server/render-page.ts`) — pages render fresh instead
  of serving the cached artifact,
- the page-render cache,
- the loader-data cache.

Isolation runs both directions: a preview visitor never sees a published
visitor's cached render (or vice versa), and a preview render never warms the
published cache — so a loader branching on `isPreviewActive()` to fetch draft
content can't leak that draft to a subsequent non-preview visitor.

```ts
// app/api/preview/enable/route.ts
import { enablePreview } from 'solidstep/utils/preview';

export async function POST() {
    enablePreview();
    return new Response(null, { status: 204 });
}
```

```ts
import { disablePreview } from 'solidstep/utils/preview';

export async function POST() {
    disablePreview();
    return new Response(null, { status: 204 });
}
```

`enablePreview()` throws if `SOLIDSTEP_PREVIEW_SECRET` is unset — gate these
routes (e.g. behind your CMS's own auth) before calling it. A tampered or
unsigned cookie is rejected exactly like preview mode being off.

> **Limitation.** Build-time SSG artifacts are served as static files and
> can't be bypassed by preview mode — only `dynamic`/`isr` routes benefit.

## Pluggable cache stores

The page-render and [loader-data](./data-loading.md#caching-loader-data) caches share a
single swappable `CacheStore` backend, so one configuration makes **both** persistent.
The default is an in-memory LRU. Select a built-in adapter via `defineConfig`:

```ts
// app.config.ts
import { defineConfig } from 'solidstep';

export default defineConfig({
  // In-memory LRU (default). Optionally tune the capacity:
  cache: { type: 'memory', maxEntries: 5000 },
  // Cap approximate total value size too (evicts LRU to stay under it) —
  // useful on memory-constrained runtimes where a count limit alone can hold
  // far more than expected:
  // cache: { type: 'memory', maxEntries: 5000, maxBytes: 64 * 1024 * 1024 },
  // Or persist entries to disk (node-server presets only):
  // cache: { type: 'filesystem', dir: '.cache/solidstep' },
});
```

To plug in an external store (e.g. Redis), implement the `CacheStore` interface
from `solidstep/utils/cache-store` and register the instance at startup inside
your instrumentation `register()` hook — this overrides the `defineConfig`
selection:

```ts
// app/instrumentation.ts
import { defineInstrumentation } from 'solidstep/utils/instrumentation';
import { setCacheStore } from 'solidstep/utils/cache';
import { RedisCacheStore } from './my-redis-store';

export default defineInstrumentation({
  register() {
    setCacheStore(new RedisCacheStore(/* ... */));
  },
});
```

A custom store computes each entry's absolute `expiresAt`/`staleAt` on `set`,
returns the `CacheEntry` on `get` (the framework enforces expiry/SWR), and
maintains its own tag → keys index for `invalidateTag`. The built-in
`MemoryCacheStore` and `FilesystemCacheStore` are exported from
`solidstep/utils/cache-store` as references.

## Related

- [Server Actions & Forms](./server-actions-and-forms.md) — where you typically call `invalidateCache` / `revalidatePath`.
- [Data Loading](./data-loading.md) — cached renders include loader data.
- [Troubleshooting](./troubleshooting.md#cache-not-invalidating) — if a cached page isn't refreshing.
