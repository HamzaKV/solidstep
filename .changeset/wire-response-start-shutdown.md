---
'solidstep': minor
---

Feat/Breaking: instrumentation gets two previously-declared-but-unwired hooks:

- **`onShutdown`** now actually fires — once, on `SIGTERM`, `SIGINT`, or
  `beforeExit` (whichever arrives first).
- **`onResponseStart`** now actually fires — once per response, right after
  its status/headers are final but before the first body byte, across every
  render path (ISR, PPR, deferred streaming, loading boundary, main render,
  error boundary, 404) and every request kind (page, API route, server
  action).

**Breaking (type-level):** `onResponseStart`'s signature dropped its
`response: Response` parameter — no such object exists at that point in the
pipeline (the body may still be under construction as a stream). It is now
`(request: Request, context: ResponseContext) => void | Promise<void>`.

**Breaking (type-level):** `onServerReady` and its `ServerInfo` type have
been removed. The framework has no reliable "server is listening" event to
report under vinxi/Nitro's process model, so this hook could never be
honestly implemented; it was declared but never invoked.
