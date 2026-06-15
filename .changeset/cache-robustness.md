---
"solidstep": minor
---

Cache robustness improvements (all additive):

- **`MemoryCacheStore` byte budget.** A new `maxBytes` option caps the
  approximate total value size, evicting LRU entries to stay under it (the newest
  entry is always kept). Configure via `defineConfig({ cache: { type: 'memory',
  maxEntries, maxBytes } })`. Guards memory-constrained runtimes where an
  entry-count limit alone can hold far more than expected when entries vary
  wildly in size (e.g. cached HTML). Sizes are only computed when `maxBytes` is
  set, so the default store is unaffected.
- **Atomic filesystem tag index.** `FilesystemCacheStore` now writes
  `__tags.json` to a unique temp file and atomically renames it into place, so a
  crash mid-write can no longer leave a truncated index that breaks every later
  `invalidateTag`.
- **`getCacheResult(key)`** (`solidstep/utils/cache`) — returns
  `{ hit, value }` so callers can distinguish a cache miss from a value
  deliberately cached as `null` (negative caching); `getCache` collapses both to
  `null`.
- **`singleFlight(key, fn, timeoutMs?)`** — an optional eviction timeout so a
  hung `fn` (an upstream that never settles) no longer pins the key forever; after
  the timeout the next caller starts a fresh flight, and the original flight's
  late settle can't evict the newer one.
