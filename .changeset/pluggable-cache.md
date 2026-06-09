---
"solidstep": minor
---

Phase 2 — hardening + pluggable cache.

- **Pluggable `CacheStore`**: the page-render and loader-data caches now run on a
  swappable backend. Built-in adapters: `MemoryCacheStore` (in-memory LRU, the
  default) and `FilesystemCacheStore` (persists entries to disk, node-server
  presets only). Select one via `defineConfig({ cache: { type: 'memory' | 'filesystem', ... } })`,
  or call `setCacheStore(store)` from `solidstep/utils/cache` inside your
  instrumentation `register()` hook to plug in an external store (e.g. Redis).
  New `solidstep/utils/cache-store` export carries the `CacheStore`/`CacheEntry`
  types and adapters for writing your own.
- **Wall-clock TTL**: cache deadlines are now absolute (`Date.now()`-based)
  instead of monotonic, so they reason in real time and survive serialization.
- **Stale-while-revalidate + tags**: `defineLoader` and page `options` accept
  `cache.swr` (serve stale while one background revalidation runs) and
  `cache.tags` (group invalidation via the new `invalidateTag(tag)`).
- **Single-flight coalescing**: concurrent identical loader loads share one
  execution instead of each running the loader.
- **Loader-error isolation**: a failing layout/group loader no longer takes down
  the whole render — it resolves to a serializable error sentinel so sibling
  content still renders. A failing page loader still renders the route `error.tsx`.

**Breaking**: the `solidstep/utils/cache` data functions (`getCache`, `setCache`,
`invalidateCache`, `clearAllCache`) are now **async** (return `Promise`) to
support filesystem/external stores. `revalidatePath` is unchanged.
