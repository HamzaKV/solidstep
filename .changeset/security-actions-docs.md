---
'solidstep': patch
---

Clarify in `docs/security.md` that server actions intentionally always forward their thrown error's message to the client (in every environment), unlike loaders which redact in production — this is the `useActionState().error()` contract, not a gap. Verified via a deep re-audit of `server-action.server.ts` and a Node repro proving ES module namespace objects (used for the dynamic server-action chunk import) have a `null` prototype, so the `name` lookup there can't be hijacked the same way `functionId` could before an earlier fix.
