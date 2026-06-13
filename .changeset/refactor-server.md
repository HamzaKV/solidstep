---
"solidstep": patch
---

Refactor of `server.ts` (no public API change) plus one streaming bug fix. Pure
HTML/inline-script generation moved to a new internal `utils/html.ts` and unit-tested
(`generateHtmlHead`, `renderAssetsToHtml`, `serializeForScript`, `jsonForScript`,
`hydrationScript`), with two dedupe helpers — `buildHydrationScript` (replacing
six near-identical inline hydration-script emissions) and `buildHeadHtml` — plus
`createBaseMeta`. The request `eventHandler` was decomposed: API-route handling
extracted to `handleApiRoute`, and the page/SSR render scoped into a `renderPage`
unit, so the handler reads as a thin request router.

**Fix:** the streamed `loading.tsx` boundary is no longer client-hydrated — it is
a transient server-rendered placeholder shown until the main content streams in
and hydrates once. (It was previously hydrating the real page with empty loader
data and racing the main hydration, intermittently leaving stale loader data on
slow routes.) Verified by the full unit + e2e suite.
