---
'solidstep': patch
---

Fix `handleServerFunction` resolving prototype-chain properties (`__proto__`, `constructor`, `toString`, `hasOwnProperty`) when a request's `functionId` matches one of them, since the chunk lookup was a plain object index. This bypassed the 404 guard and fell into the generic error handler, which — unlike this file's other dispatch-level 404/400 paths — has no dev-only gate on the error message, leaking an internal implementation detail (`"chunkEntry.import is not a function"`) to the client in production. The lookup now uses `Object.hasOwn`.
