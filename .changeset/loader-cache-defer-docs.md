---
"solidstep": patch
---

Docs: clarify two capabilities that were mislabeled as "on the roadmap" — they're
already available.

- **Persistent/shared loader cache.** Loader data caching runs on the same pluggable
  `CacheStore` as the page cache, so configuring a filesystem or external (e.g. Redis)
  store via `defineConfig({ cache })` (or `setCacheStore` in instrumentation) makes loader
  data persistent and shared across processes — not just in-memory per-process.
- **Per-group `defer`.** Parallel-route group (`@slot`) loaders support `type: 'defer'`,
  streaming their own `loading.tsx` on first load and fetching on client navigation,
  independently of the rest of the page. (Layout loaders remain sequential by design.)

Adds confirming tests: loader caching against `FilesystemCacheStore` (including persistence
across a fresh store instance) and a soft-navigation deferred-group e2e.
