---
"solidstep": patch
---

Make the route trie reject (instead of silently colliding) two sibling routes
at the same folder depth whose `[param]` or `[...catchAll]` names differ, e.g.
`app/shop/[id]/page.tsx` alongside `app/shop/[slug]/page.tsx` -- previously
the first-inserted name silently won and the second route became unreachable
with no warning. Fix an unhandled promise rejection risk during server boot:
a broken user `instrumentation.ts` (throwing on import/register) is now
caught and logged instead of rejecting the module-scope readiness promise
unhandled, which could crash the process at startup or bypass solidstep's
own redirect/dev-overlay/500 error handling for every request thereafter.
