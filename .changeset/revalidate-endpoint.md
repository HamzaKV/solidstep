---
'solidstep': minor
---

Add an on-demand revalidation endpoint (`/__solidstep_revalidate`), gated on `SOLIDSTEP_REVALIDATE_TOKEN`. When the env var is unset the endpoint is unreachable (404, like any unmatched route) — no separate feature flag needed.

POST with `Authorization: Bearer <token>` and either `{ "path": "/some/route" }` (invalidates that path's page-render cache and, for `isr` routes, its ISR artifact) or `{ "tag": "some-tag" }` (calls `invalidateTag`). Wrong/missing token → 401 (constant-time compared); non-POST → 405; a body with neither `path` nor `tag` → 400.

Also adds `timingSafeEqualString` (`solidstep`'s internal `utils/crypto.ts`) for comparing secrets without leaking their value through response-time differences.
