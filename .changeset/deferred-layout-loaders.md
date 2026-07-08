---
'solidstep': minor
---

Layout loaders now support `type: 'defer'`, matching page and parallel-route group loaders — mark a layout's own loader deferred to stream its shell immediately while its data loads in the background.

Layouts have no `loading.tsx`/`error.tsx` of their own, so a deferred layout falls back to the **route's** `loading.tsx`/`error.tsx` when present (no fallback/boundary when absent, same as a page-level deferred loader with no `error.tsx`).

**Breaking (behavior, not API):** marking a layout loader `type: 'defer'` changes its failure contract, not just its timing. A **sequential** layout loader never throws — it yields a serializable error sentinel merged into `loaderData`, and siblings still render. A **deferred** layout loader throws toward `error.tsx` on rejection instead, exactly like a deferred page/group loader. This only applies to loaders you explicitly mark `type: 'defer'`; existing sequential layout loaders are unaffected.
