---
'solidstep': patch
---

Fix `bodyLimit()` allowing an oversized body through when `Content-Length` is present but malformed or ambiguous (e.g. a comma-joined duplicate value like `"10, 999999999"`, a classic request-smuggling technique) — it was treated the same as a genuinely absent header ("unknown length, allow"). `parseContentLength` now distinguishes the two: `null` for an absent header (still allowed, e.g. chunked transfer), `NaN` for a present-but-unparseable one (now rejected).

**Breaking:** `parseContentLength('abc')` / `parseContentLength('-5')` now return `NaN` instead of `null` — check `Number.isNaN(...)` if you were relying on the old `null` return for malformed input.
