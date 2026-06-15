---
"solidstep": minor
---

Add secure-by-default security helpers (all additive — existing APIs unchanged):

- **`setSecureCookie(key, value, options?)`** (`solidstep/utils/cookies`) — sets a
  cookie with `httpOnly`, `sameSite: 'lax'`, `path: '/'`, and `secure` (in
  production) applied by default, so session/auth cookies can't accidentally ship
  without their protective flags. Any field is still overridable via `options`.
- **`safeRedirect(url, { allowedHosts?, fallback? })`** and
  **`isSafeRedirectTarget(url, allowedHosts?)`** (`solidstep/utils/redirect`) —
  open-redirect-safe redirects for untrusted destinations (`?next=` params, form
  fields). Only same-site relative paths and allowlisted absolute hosts pass;
  off-site URLs, `javascript:`/`data:`, and protocol-relative `//host` are
  rejected (falling back to `'/'`).
- **`createNoncePolicy(nonce)`** (`solidstep/utils/csp`) — a production-ready CSP
  preset: the strict baseline plus the per-request nonce on `script-src` /
  `style-src`, with no `'unsafe-inline'` / `'unsafe-eval'`. `createBasePolicy()`'s
  doc now clearly warns that it is a permissive dev convenience.
- **`cors(..., { allowCredentials: true })`** (`solidstep/utils/cors`) — opt-in
  `Access-Control-Allow-Credentials: true` for trusted origins, enabling
  credentialed cross-origin requests.
