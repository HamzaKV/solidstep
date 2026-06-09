---
"solidstep": minor
---

Add deferred page loaders (streaming SSR). Mark a page loader `type: 'defer'` and
its data is exposed to the page as a Solid resource accessor read under
`<Suspense>`. The framework renders such routes with Solid's `renderToStream`:
the shell streams immediately (with the route's `loading.tsx` as the Suspense
fallback) and the deferred data streams in and hydrates afterwards. Non-deferred
routes are unchanged and keep the standard `renderToString` path. This is the
foundation for partial pre-rendering (PPR).
