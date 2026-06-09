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

2. Using the `revalidatePath` utility to revalidate specific paths and revalidate the frontend DOM - signaling the server action as a Single Flight Mutation query.
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

## Pluggable cache stores

The page-render and loader-data caches run on a swappable `CacheStore` backend.
The default is an in-memory LRU. Select a built-in adapter via `defineConfig`:

```ts
// app.config.ts
import { defineConfig } from 'solidstep';

export default defineConfig({
  // In-memory LRU (default). Optionally tune the capacity:
  cache: { type: 'memory', maxEntries: 5000 },
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
