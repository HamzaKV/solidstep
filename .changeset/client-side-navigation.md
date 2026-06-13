---
"solidstep": minor
---

Add client-side (soft) navigation. SolidStep is now a true SPA-on-navigation
framework instead of a full-reload MPA:

- **`<Link>`** (`solidstep/link`) and **`useNavigate`** (`solidstep/router`)
  perform soft navigations: the document is not reloaded, the target route's
  loader data + metadata are fetched in one request, and the page re-renders
  reactively. `<Link>` renders a real `<a href>` and is progressive-enhancement
  safe (works as a normal link with JS disabled or for external targets), with
  hover/viewport/eager `prefetch`.
- New `solidstep/router` API: `useNavigate`, `useRouter`, `usePathname`,
  `useSearchParams`, and a `navigationPending` signal.
- The root layout stays mounted across navigations; loader-data revalidation
  (from `revalidatePath` in a server action) now updates the mounted components
  **in place** (preserving local state like form inputs) by re-rendering
  reactively instead of patching the DOM.
- History (back/forward), scroll restoration, and `<title>`/metadata updates are
  handled automatically. Redirects, errors, and not-found are resolved through a
  serialized route-data envelope so a client fetch can't follow or fail them.
- **Removed the hand-rolled `diff-dom`** DOM-patching module; server-action
  revalidation now re-renders reactively (`refreshRoute`).

Internally this adds a `/__solidstep_route` endpoint that resolves a route's full
loader data + metadata (seroval-serialized, so Date/Map/etc. survive) and an
isomorphic client route matcher that mirrors the server's route trie 1:1 for
hydration-safe matching.
