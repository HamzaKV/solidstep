---
"solidstep": patch
---

Security & correctness hardening of the SSR output:

- **Page cache no longer caches by default.** Plain `dynamic` pages were being
  written to the page-render cache with no expiry and keyed by pathname only —
  so a page rendered once was served to everyone afterwards and query strings
  collided. Pages are now cached **only** when they opt in with a positive
  `options.cache.ttl` (matching the documented contract and the loader cache),
  and the cache key includes the query string.
- **XSS hardening.** Loader data, route params, and metadata are now escaped
  before being written into the HTML/inline-script output: attribute values and
  text are HTML-escaped, and script-embedded payloads are escaped so a value
  containing `</script>` can no longer break out.
- **Loader data uses seroval.** Loader-data hydration now uses the same seroval
  transport as server actions, so `Date`, `Map`, `Set`, and `BigInt` returned
  from a loader round-trip to the client intact instead of degrading.
