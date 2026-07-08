---
'solidstep': patch
---

Fix preview mode's page-render cache and loader-data cache leaking content across the preview/published boundary. Previously preview mode only skipped the cache *read*, still writing to (and, via `singleFlight`, coalescing onto) the same key a non-preview visitor reads from — a loader that branches on `isPreviewActive()` to serve draft content could leak that draft into the published cache, and concurrent preview/non-preview requests for the same key could coalesce onto each other's in-flight execution in either direction.

Preview mode now reads and writes an entirely separate, `preview:`-prefixed cache namespace (and a correspondingly separate `singleFlight` key), for both the page-render cache (`server/render.ts`) and the loader-data cache (`utils/loader-cache.ts`). Preview still benefits from caching — it's isolated, not disabled.

**Breaking:** a preview render previously warmed the published cache for the next non-preview visitor; it no longer does.
