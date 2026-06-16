---
"solidstep": minor
---

Robustness, security, and observability hardening (all additive; one behavior change to error responses):

- **Loader timeouts & abort propagation.** `defineLoader` accepts a per-loader
  `timeout` (ms), and `defineConfig({ loaderTimeout })` sets a global default. A
  loader that exceeds its timeout is aborted and rejects with `LoaderTimeoutError`
  (a page loader then renders `error.tsx`; a layout/group loader yields the usual
  error sentinel). The request's abort signal is now also threaded into loaders so
  a client disconnect cancels in-flight work. `LoaderTimeoutError` /
  `runWithLoaderTimeout` / `resolveLoaderTimeout` are exported from
  `solidstep/utils/loader-timeout`.
- **Request-scoped loader context.** Loaders now receive a second argument,
  `{ locals, signal }` — the middleware-populated `event.locals` plus the combined
  abort signal. `Locals` (augmentable via declaration merging) and `LoaderContext`
  are exported from `solidstep/utils/loader`. Existing single-argument loaders are
  unaffected.
- **Production error-message hardening (behavior change).** When a page loader
  throws during a soft navigation, the error envelope no longer leaks the raw
  error message to the client in production: it logs the message server-side under
  a generated `errorId` and returns a generic message plus that id. In development
  the full message is still sent.
- **Rate-limit & body-size middleware.** New `rateLimit(...)`
  (`solidstep/utils/rate-limit`, backed by the active `CacheStore`) returns `429`
  with `Retry-After` once a key exceeds its window, and `bodyLimit(...)`
  (`solidstep/utils/body-limit`) returns `413` for oversized `Content-Length`.
  Both compose with `defineMiddleware`.
- **Built-in request metrics.** `createMetricsInstrumentation(...)`
  (`solidstep/utils/metrics`) returns an `onResponseEnd` hook that emits one
  structured record per request (timing, status, route, render strategy, cache
  status) to the logger or a custom `sink`. The framework now records the render
  strategy on the request `metadata`.
- **Surfaced cache failures.** Previously-silent `catch` paths in the cache
  stores now log through the framework logger (quiet by default), so cache
  corruption / unserializable values are diagnosable.
