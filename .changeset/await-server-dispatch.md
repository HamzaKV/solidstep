---
'solidstep': patch
---

Fix: the top-level request handler now `await`s its delegated dispatch
(`handleServerFunction`, `handleApiRoute`, `renderPage`) instead of returning
the promise directly. Returning an unawaited promise from inside a `try` block
does not let a later rejection reach that block's `catch` — it only chains
onto the outer async function's own returned promise. A rejected server
action, API route, or page render therefore surfaced as an unhandled
rejection instead of the framework's mapped response: a thrown
`RedirectError` never became its 302, and any other error skipped the
dev-overlay/500 fallback entirely.
