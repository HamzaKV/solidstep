---
'@varlabs/create-solidstep': patch
---

Harden the scaffolded `app/middleware.ts` template:

- `event.locals` is now merged rather than clobbered when the security
  middleware sets `cspNonce`, so it no longer wipes out fields set by
  earlier middleware in the chain.
- Added `bodyLimit`/`rateLimit` with conservative defaults (1 MB body cap,
  100 req/min per IP), running first so oversized/abusive requests
  short-circuit before the CSP/CSRF/CORS work.
- `trustedOrigins` now reads from a `TRUSTED_ORIGINS` env var
  (comma-separated), falling back to the placeholder example origins, with
  an EDIT-ME comment. A new `.env.example` documents the variable, and
  `.env`/`.env.local` are gitignored.
