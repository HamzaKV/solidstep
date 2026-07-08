---
'solidstep': patch
---

**Security fix.** `FilesystemCacheStore`'s tag index was a plain JSON-parsed object, so a cache entry tagged (or invalidated) with a tag literally named `__proto__` resolved `index['__proto__']` through the prototype chain to the real `Object.prototype` object instead of `undefined` — crashing with an uncaught `TypeError` in both `set()` and `invalidateTag()`. `invalidateTag` is reachable via the on-demand revalidation endpoint (`{ tag: "__proto__" }`, gated by `SOLIDSTEP_REVALIDATE_TOKEN`), so an authenticated caller could 500 the endpoint. Fixed by building the tag index with `Object.create(null)`.
