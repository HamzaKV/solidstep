---
'solidstep': minor
---

Feat/Breaking: dynamic route params and catch-all segments are now
percent-decoded.

`/blog/hello%20world` now yields `slug: 'hello world'` (previously the raw
`'hello%20world'`). A catch-all decodes each segment individually, so
`/docs/a%2Fb` yields `path: ['a/b']`, not a merged segment. A malformed
encoding (e.g. a lone trailing `%`) passes through raw rather than throwing.
Static path segments are unaffected — they still match on their raw form.

If you call `decodeURIComponent` on a route param yourself today, remove
that call: decoding an already-decoded value can mangle a param containing
a literal `%` (e.g. `100%` becomes `100` if re-decoded, or throws before this
change if it's not actually double-encoded).
