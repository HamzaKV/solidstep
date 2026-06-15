---
"solidstep": patch
---

Internal refactor of `server.ts` (no public API change), continuing the
decomposition:

- The synchronous loading-placeholder swap — the inline `<script>` that replaces
  a streamed `loading.tsx` shell with the real page without wiping `<head>` — was
  extracted from `server.ts` into a dedicated, unit-tested `utils/loading-swap.ts`
  (`buildLoadingSwapScript`), so the gnarliest piece of inline render logic is now
  covered in isolation.
- The render branches now use a single typed `pageEntry: RoutePageHandler`
  narrowed once after API-route dispatch, removing all fifteen
  `matched as RoutePageHandler` casts on the page-render hot path (compile-time
  only — no behavior change).
