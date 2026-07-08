---
'solidstep': patch
---

Fix the no-JS server-action fallback (a plain `<form>` POST without client-side JS) redirecting to an unvalidated `Referer` header. A cross-origin or malformed `Referer` now falls back to `/` instead of redirecting to whatever value the client sent — previously a caller that bypassed the built-in origin check (e.g. a non-browser client sending neither `Origin` nor `Sec-Fetch-Site`, both of which are treated as trusted per the existing policy) could invoke a real server action and receive a 303 to an arbitrary URL.
