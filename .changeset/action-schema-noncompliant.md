---
'solidstep': patch
---

`parseActionInput` now throws if a schema's `~standard.validate` returns neither `{ issues }` nor `{ value }` (a non-compliant/buggy schema), instead of silently returning `undefined` as if it were valid input.
