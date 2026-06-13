---
"solidstep": minor
---

Soft-navigation now integrates with `<Suspense>` for `defer` loaders, and the
navigation-pending signal is wired up.

- **Deferred loaders stream during soft navigation.** Previously a soft-nav to a
  route with a `type: 'defer'` loader blocked until the slow data resolved. Now
  the `/__solidstep_route` envelope leaves deferred holes unresolved; the client
  commits the shell instantly and fills each hole from `/__solidstep_loader`
  under `<Suspense fallback={loading.tsx}>` — so `defer` behaves the same on
  first load and on navigation (instant shell + per-hole loading state).
- **Navigation pending UI.** `navigationPending` (from `solidstep/router`) is a
  reactive signal that is `true` while the next route's data is being fetched —
  use it to render a global loading indicator. Navigations commit immediately
  (via `batch`, not a transition) so deferred boundaries show their `loading.tsx`
  right away rather than being held back.
- Prefetch (hover/viewport/eager on `<Link>`) and module warming from the
  previous release are unchanged; this adds the `<Suspense>`/pending-UI half of
  the story.
