---
'solidstep': minor
---

Fix deferred-loader errors not reliably reaching `error.tsx`.

A deferred (`type: 'defer'`) group or page loader that rejects after the
shell's first flush previously left its `<ErrorBoundary>` fallback empty
(no error message) once hydrated, even though the raw SSR HTML fragment
did carry the rejection. Root cause: `ErrorBoundary` restores its own
hydration state via a non-incrementing id read
(`sharedConfig.getContextId()`), while the resource it wraps consumes an
id via the incrementing `sharedConfig.getNextContextId()`. When
`ErrorBoundary` directly wraps a `<Suspense>` around a single resource
read — exactly the shape used for deferred groups/pages — both calls
land on the same id, so the boundary picks up the resource's raw
hydration-restore entry (a `{state, value}` wrapper, not an `Error`) as
its own caught error. A `createUniqueId()` call between the boundary and
the resource burns one id so they no longer collide.

Also adds an `<ErrorBoundary>` around page-level (non-group) deferred
loaders — previously a rejection there had no `error.tsx` path at all;
only `renderToStream`'s `onError` logged it.
