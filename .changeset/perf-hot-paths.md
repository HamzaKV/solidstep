---
'solidstep': patch
---

Performance: cache static per-build work on the server hot path (client-manifest payload, per-route streaming/defer flags, per-module asset lists — all prod-only, dev/HMR unaffected), thread one parsed request URL through the dispatcher instead of re-parsing it repeatedly, skip building instrumentation request/response contexts when no hooks are registered, reuse `TextEncoder`/`TextDecoder` in the seroval transport instead of allocating per chunk, use a cheaper asset-dedupe key, and skip a redundant `Request` clone in loader invocation when there's nothing to change. On the client, navigation now starts warming a route's component modules in parallel with its data fetch instead of sequentially after it, and `prefetch="viewport"` `<Link>`s share a single `IntersectionObserver` instead of one per link.
