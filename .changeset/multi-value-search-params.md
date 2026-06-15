---
"solidstep": minor
---

`searchParams` now preserves repeated query keys as arrays, matching Next.js.
Previously the framework built `searchParams` with `Object.fromEntries(...)`, which
silently kept only the **last** value for a repeated key (`?tag=a&tag=b` →
`{ tag: 'b' }`), dropping earlier values for filter/multi-select UIs. A new
`parseSearchParams` helper now produces `{ tag: ['a', 'b'] }` consistently across
page props, API-route handler context, the instrumentation request context, and
the soft-navigation envelope.

**Breaking (types):** the `searchParams` shape is now
`Record<string, string | string[]>` everywhere (e.g. `PageProps['searchParams']`,
the `route.ts` handler `ctx.searchParams`, and `useSearchParams()`). A single
occurrence is still a `string`; only repeated keys become arrays. Code that
assumed `searchParams[key]` was always a `string` may need a narrowing check.

Also hardens the `csrf()` check: a malformed `Origin` or `Referer` header now
fails the check closed (returning `{ success: false }`) instead of throwing an
unhandled error that surfaced as a 500.
