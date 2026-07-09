---
'solidstep': patch
---

Add regression coverage for two deferred layouts stacked in the same chain (one nested inside the other), where only the inner one fails. Verified this already works correctly — the inner layout's own error surfaces via the route's shared error.tsx without being garbled by an id collision with the outer (successful) layout's hydration data, and without hydration-mismatch console errors. No code change; this closes a gap in test coverage for the recently-added deferred layout loaders feature.
