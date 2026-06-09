---
"solidstep": minor
---

Add per-group loading and error boundaries for parallel routes. A `@group`
directory can now include its own `loading.tsx` and/or `error.tsx`:

- `error.tsx` isolates the slot — if the group's loader rejects or its component
  throws, only that slot renders its error page (receiving the `error` prop)
  while sibling slots and the page render normally.
- `loading.tsx` is the `<Suspense>` fallback for a group with a deferred loader,
  shown until the slot's data streams in.

Such routes render via `renderToStream` so the boundaries hydrate consistently;
groups without a boundary or deferred loader are unchanged.
