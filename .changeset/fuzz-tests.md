---
'solidstep': patch
---

Add randomized fuzz testing (a small dependency-free seeded-PRNG helper, `tests/fuzz-helpers.ts`) for every security-sensitive parser touched during this hardening pass: `isSafeRedirectTarget`, CSP's `assertSafeSource`, `parseContentLength`/`isOverBodyLimit`, `csrf`/`cors` origin matching, `formDataToObject` (via `parseActionInput`), and `handleRevalidate`'s payload parsing. Each asserts a concrete invariant (never throws, never approves an unsafe input, never lets a value leak across fields, the coerced object's prototype is never tampered) across thousands of randomized adversarial inputs — control characters, unicode edge cases, prototype-pollution-shaped keys, and injection fragments a hand-written test wouldn't think to include. No code changes; all invariants held.
