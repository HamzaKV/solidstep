---
'solidstep': patch
---

`{ path }` revalidation now also invalidates the preview-namespaced page-cache entry for that path (`preview:${path}`), not just the published one. Preview mode's whole purpose is letting an editor see an unpublished edit immediately — without this, a `{ path }` revalidate call left the stale preview-cached render in place until its own `ttl`/`swr` window naturally expired.
