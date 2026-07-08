---
'solidstep': patch
---

**Security fix.** `parseActionInput`'s FormData coercion built its plain object with `{}`, which inherits `Object.prototype`'s `__proto__` accessor. A form submission with a field literally named `__proto__` whose value is a `File` (trivial to craft directly via a raw multipart POST, no client-side form needed) replaced the coerced input's own prototype with that `File` instance instead of storing it as a normal property — silently exposing the file's own properties (`name`, `type`, `size`, ...) through every other field lookup on the input object. Depending on the schema, this could bypass a required-field check (a schema field named `name`, `type`, or `size` would incorrectly validate using the attacker-chosen `File`'s own property) or crash with an uncaught internal `TypeError`, leaking implementation details via `X-Error` in production. Fixed by building the coerced object with `Object.create(null)` instead of `{}`.
