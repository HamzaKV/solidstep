---
'solidstep': patch
---

Add load/concurrency regression tests for the shared-mutable-state paths touched during this hardening pass, at far higher concurrency than existing coverage (which topped out at 2-3 concurrent callers): `rateLimit` (450 truly-interleaved calls across 15 keys, exact per-key counts), `FilesystemCacheStore`'s tag index (80-way concurrent `set()` across overlapping tags, plus a 100-op concurrent `set`/`delete`/`invalidateTag` mix asserting the tags file is always valid JSON afterward), `singleFlight` (2000 calls across 100 keys, exactly one execution per key), the loader cache's preview/non-preview key isolation (75 interleaved calls across 25 paths and both preview states), and `handleRevalidate` (200 concurrent path/tag invalidations, exact call-count accounting). No code changes; every invariant already held.
