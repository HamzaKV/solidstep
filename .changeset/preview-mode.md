---
'solidstep': minor
---

Add preview mode (`solidstep/utils/preview`): `enablePreview()` / `disablePreview()` set/clear an HMAC-signed cookie (`SOLIDSTEP_PREVIEW_SECRET`, `node:crypto`, no dependency). While active for a visitor, their requests skip **reads** (never writes) of the ISR short-circuit, the page-render cache, and the loader-data cache, so editors can preview unpublished content without waiting for a cache window to expire.

`enablePreview()` throws when `SOLIDSTEP_PREVIEW_SECRET` is unset. A tampered, unsigned, or wrong-secret cookie is treated exactly like preview mode being off. Build-time SSG artifacts, served as static files, can't be bypassed.
