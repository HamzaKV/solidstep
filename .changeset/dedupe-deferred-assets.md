---
'solidstep': patch
---

Fix duplicate `<link>`/`<script>` tags when a route's deferred layout loader and deferred page loader (or two independently-deferred layouts in a chain) share the same `loading.tsx`/`error.tsx` — each independently resolved and pushed the same asset entries into the render's shared asset list. `renderAssetsToHtml` now dedupes identical assets before rendering.
