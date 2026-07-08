---
'solidstep': patch
---

Refactor (no behavior change): extract the `createUniqueId()` id-collision guard for deferred `ErrorBoundary`s — previously copy-pasted 3 times in `server/render.ts` and 4 times in `client.ts` — into one `idSafeErrorBoundary` helper per file. A future new deferred-boundary shape now goes through a single choke point instead of risking forgetting the burn and silently reintroducing the id-collision bug fixed earlier this phase.
