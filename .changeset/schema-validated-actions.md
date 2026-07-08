---
'solidstep': minor
---

Add `parseActionInput(schema, formData)` (`solidstep/utils/action-schema`) — coerces `FormData` into a plain object (repeated keys become arrays, `File` values stay `File`) and validates it against a Standard Schema V1-compatible schema (Zod, Valibot, ArkType). On failure it throws `ValidationError`, carrying the schema's `.issues`.

Call it from inside your own `'use server'` action — validation must run there to be enforced; a wrapping `defineAction`-style combinator can't do this safely, because the build's `'use server'` transform extracts only the exact function the directive is attached to, discarding any enclosing call.

`ValidationError` crosses the server-action wire via seroval, which reconstructs a plain `Error` rather than preserving the subclass — narrow it with the new `isValidationError(err)` helper (checks `.name`), not `instanceof`.
