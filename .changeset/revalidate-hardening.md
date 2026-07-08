---
'solidstep': patch
---

Harden the on-demand revalidation endpoint (`server/revalidate.ts`):
- Reject bodies over 10KB with a 413 before parsing — the endpoint is dispatched before the app's own middleware pipeline, so a configured `bodyLimit()` never protected it.
- A request body with both `{ path, tag }` now invalidates both instead of silently dropping `path` in favor of `tag`.
- The `Authorization: Bearer` scheme is now matched case-insensitively, per RFC 7235.
