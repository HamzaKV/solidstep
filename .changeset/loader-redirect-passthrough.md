---
'solidstep': patch
---

Fix: `redirect()` thrown inside a **layout/group loader** is no longer swallowed
into the per-node error sentinel. `runSequentialLoader` now re-throws
`RedirectError`, so auth-gating layouts (e.g. `redirect('/login')` when a session
cookie is missing) abort the render and issue the redirect response, matching the
0.3.x behavior and the page-loader contract. Previously the gated layout rendered
with a sentinel `loaderData`, typically crashing on missing user data (500) and
leaking the gated tree render.
