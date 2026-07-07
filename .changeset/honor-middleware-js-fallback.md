---
'solidstep': patch
---

Fix: `defineConfig` computed a `middlewarePath` that fell back from
`app/middleware.ts` to `app/middleware.js`, but the ssr router config
hardcoded the literal `'./app/middleware.ts'` instead of using it. A project
with only `app/middleware.js` (or no middleware file at all) silently got
the wrong — or a nonexistent — middleware wired in. The resolved path is now
actually passed to the router; `middleware` is `undefined` when neither file
exists (vinxi's schema marks it optional).
