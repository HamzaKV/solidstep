---
"solidstep": patch
---

Fix: the deferred/PPR hole-data endpoint (`/__solidstep_loader`) now serializes
with **seroval** instead of plain JSON, matching the soft-navigation envelope and
the first-load streamed path. Previously, deferred loader data fetched to fill a
PPR hole (or a deferred loader on a soft navigation) silently lost non-JSON types
— a loader returning `{ createdAt: new Date() }` round-tripped correctly on first
load and full navigation but arrived as a string through a hole. Now `Date` /
`Map` / `Set` / `BigInt` survive identically across every data path. The response
`Content-Type` for this endpoint changes from `application/json` to
`text/plain; charset=utf-8` accordingly.
