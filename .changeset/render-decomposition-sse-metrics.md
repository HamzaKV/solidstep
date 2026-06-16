---
"solidstep": minor
---

Internal hardening, new helpers, and docs (the only user-facing API change is the
`onRequestError` signature):

- **`onRequestError` now receives `(error, request, context)`.** The hook type was
  widened to include the request — matching `onRequest`/`onResponseEnd` and the
  arguments the framework already passed at runtime. A hook whose second parameter
  was typed `RequestContext` will now get a type error; rename it to `request` and
  read the context from the third parameter.
- **Request metrics now include `cacheStatus`** (`'hit'` / `'miss'`) alongside
  `renderStrategy`, surfaced through `createMetricsInstrumentation`
  (`solidstep/utils/metrics`).
- **New `solidstep/utils/sse`** — `sseResponse` (Server-Sent Events) and
  `streamResponse` helpers for streaming responses from `route.ts` handlers.
- **Hardened the streamed loading-boundary swap** with a one-shot `location.reload()`
  fallback so a failed swap can't strand the loading shell, and routed the
  previously-silent ISR background-revalidation / prerender-manifest failures
  through the logger.
- **Internal:** the `server.ts` request handler was decomposed — the page render
  now lives in `server/render-page.ts` over the `server/render.ts` engine (now
  unit-tested), and the render hot path was retyped with discriminated-union
  guards. No behavior change.
- **Docs:** new Data Validation, Database & ORM, and Performance guides, plus an
  expanded request-lifecycle/architecture reference.
