---
'solidstep': patch
---

Fix a race in `rateLimit`/`checkRateLimit`: concurrent requests for the same
bucket key could each read the same pre-increment count before any of them
wrote back, losing increments and letting traffic exceed `max`. Same-key
calls are now serialized through an in-process lock so the read-modify-write
can't interleave within a single process/instance.

A deployment running multiple instances behind a shared external
`CacheStore` (e.g. Redis) still has a small residual race across instances,
since no `CacheStore` currently exposes an atomic increment — this fixes the
single-process case, which covers the default in-memory store and any
single-instance deployment.
