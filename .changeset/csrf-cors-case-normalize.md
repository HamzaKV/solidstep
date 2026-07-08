---
'solidstep': patch
---

`csrf()` and `cors()` now compare `trustedOrigins` entries case-insensitively. `URL.host` (and a real browser's `Origin` header) is always lowercase, so an uppercase character anywhere in a configured `trustedOrigins` entry previously failed to match silently and permanently — a production misconfiguration trap rather than an exploit.
