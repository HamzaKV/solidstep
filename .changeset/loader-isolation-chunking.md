---
'solidstep': patch
---

Fix a silent cross-chunk missing-import bug in the `app-server` Vite build: a layout's loader calling a sibling function exported from the same file could get split by Rollup across different per-route compiled chunks, with some chunks keeping the call but dropping the import -- a `ReferenceError` on every request for whichever routes landed in the affected chunk, in both dev and production builds. Every `app/` route module is now forced into its own single Rollup chunk (keyed by content hash) so a file's exports can never be split apart. Also, loader-isolation failures (a layout/group loader failing or timing out) now always `console.error`, independent of the configured (default silent) pino logger, so this class of bug leaves a trace instead of failing silently.
