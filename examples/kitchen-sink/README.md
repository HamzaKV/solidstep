# kitchen-sink

A comprehensive SolidStep example app that exercises the framework's features, used as the target for the Playwright end-to-end suite.

## What it covers

| Route / file | Feature |
|--------------|---------|
| `/` + `app/layout.tsx` | SSR, root loader, `generateMeta`, hydration |
| `/about` | static nested route |
| `/blog/[slug]` | dynamic param |
| `/docs/[...path]` | catch-all route |
| `/shop/[[...path]]` | optional catch-all route |
| `/dashboard` + `@analytics` / `@team` | parallel routes with concurrent loaders |
| `/slow` + `loading.tsx` | streaming loading boundary |
| `/boom` + `error.tsx` | error boundary |
| `app/not-found.tsx` | custom 404 |
| `/api/health` `route.ts` | API route handler (GET/POST) |
| `/counter` + `actions.ts` | server action via `useActionState` (incl. the `error` accessor) |
| `app/middleware.ts` | composable `defineMiddleware` (CSP nonce, CSRF, CORS) |

## Running

The app consumes the framework from its **built** output (`packages/solidstep/dist`)
via a `link:` dependency, so the framework must be built first. The `test:e2e`
script does this for you.

```bash
# From the repo root (installs workspaces and links the built dist)
pnpm install

# Build framework + app, then run the Playwright suite
pnpm --filter kitchen-sink test:e2e

# One-time: install the Playwright browser
pnpm --filter kitchen-sink exec playwright install chromium
```

Other scripts:

- `pnpm --filter kitchen-sink dev` — run the dev server
- `pnpm --filter kitchen-sink build` — production build (`vinxi build`)
- `pnpm --filter kitchen-sink start` — start the built server
- `pnpm --filter kitchen-sink test:e2e:ui` — Playwright UI mode

## Notes

- **Node version / `node:sqlite`** — Nitro's default Node database connector
  bundles an (unused) `import 'node:sqlite'`, a builtin that only exists in
  Node 22.5+. Since this app uses no database, `app.config.ts` aliases that
  builtin to `sqlite-stub.mjs` so the production server runs on Node 20/21.
- **`<Form>`** — the `/counter` route uses solidstep's `<Form>` component
  (server-rendered via Solid's isomorphic `Dynamic`) together with
  `useActionState` to drive a server action.
