---
'solidstep': minor
---

Feat: `<Form>` gains an optional `onError` prop, called when its `action`
rejects — previously the error was only logged via `console.error` with no
way to surface it in the UI. Pass `onError` to handle it yourself; omit it
to keep the previous logging behavior.

`useActionState`'s `formAction` now returns a `Promise<void>` that resolves
once the action settles (whether it succeeds or throws), instead of being
fire-and-forget. Await it if you need to know when a submission finished —
existing callers that ignore the return value are unaffected.
