---
"solidstep": minor
"@varlabs/create-solidstep": minor
---

Developer-experience polish: typed routes, a dev error overlay, and a richer starter.

- **Typed routes.** A build/dev Vite plugin scans `app/` and generates a
  `solidstep-env.d.ts` that declaration-merges your routes into the `Register`
  interface from `solidstep/router`. `<Link href>` and `useNavigate(to)` are then
  type-checked against your actual routes (typos are compile errors), and
  `PageProps<'/blog/[slug]'>` / `RouteParams<'/blog/[slug]'>` give typed
  `routeParams`. Projects without generated types still compile (the helpers fall
  back to accepting any string). The file is regenerated on `vinxi dev`/`build`;
  add it to `.gitignore`.
- **Dev error overlay.** In development, an unhandled SSR error (no `error.tsx`),
  a server-action error, or a client hydration/navigation error now shows a rich
  in-browser overlay (message + stack) instead of a bare 500. Routes with an
  `error.tsx` still render it. Production behavior is unchanged (the overlay is
  tree-shaken out).
- **Richer `create-solidstep` starter.** The default template is now a guided
  tour: `<Link>` navigation with a pending indicator, a loader page, a static
  page, a dynamic `[slug]` route using typed `PageProps`, a server action with
  `<Form>`/`useActionState`, and `loading`/`error`/`not-found` boundaries. Also
  fixes the starter's `instrumentation.ts` `onRequestError` signature.
