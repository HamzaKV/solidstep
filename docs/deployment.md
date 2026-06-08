# Deployment

[← Back to docs index](./README.md)

SolidStep builds on [Vinxi](https://github.com/nksaraf/vinxi) and [Nitro](https://nitro.build/), so deployment follows their conventions.

## Building

Build your app with Vinxi:

```bash
vinxi build
```

This produces a `.output/` directory containing the server bundle and client assets.

## Running

Start the production server with Node:

```bash
node .output/server/index.mjs
```

By default the server listens on port `3000` (override with the `PORT` environment variable).

## Nitro Presets

The deployment target is controlled by the Nitro preset, set via `server.preset` in `app.config.ts`:

```tsx
import { defineConfig } from 'solidstep';

export default defineConfig({
  server: {
    preset: 'node-server',
  },
});
```

The `create-solidstep` templates use the Node presets:

- `node` — a Node.js handler suitable for embedding.
- `node-server` — a standalone Node HTTP server (run with `node .output/server/index.mjs`). This is what the starter template uses.

Because the target is just a Nitro preset, you can deploy to other platforms by changing `server.preset`. Nitro presets include (among others):

- `vercel`
- `cloudflare` (and `cloudflare-pages` / `cloudflare-module`)
- `netlify`
- `azure-functions`

Refer to the [Nitro deployment docs](https://nitro.build/deploy) for the full list and per-platform configuration.

## Build Output Notes

- **`server-assets/`** — the [server assets](./api-routes.md#server-assets) directory is copied into the build so files like templates remain available at runtime via `process.cwd()`.
- **`.config.json`** — a generated config file in the server build holds the resolved [logger](./utilities.md#logging) configuration, read at server startup.

## Environment Variables

SolidStep uses Vite for environment handling (see [Assets & Environment](./assets-and-env.md#environment-variables)):

- Variables are loaded from `.env` files.
- Only variables prefixed with `VITE_` are exposed to client-side code.
- Unprefixed variables remain server-only — use them for secrets.

In production, provide environment variables through your host/runtime as usual; `VITE_`-prefixed values are inlined at build time, so set those before running `vinxi build`.

## Node Version

SolidStep requires **Node >= 20**.

> **Node 20/21 and `node:sqlite`:** Nitro's default Node database connector bundles an (unused) `import 'node:sqlite'`, a builtin that only exists in Node 22.5+. On Node 20/21 the server can crash at startup even when no database is used. The `create-solidstep` template ships a `sqlite-stub.mjs` and aliases the builtin to it in `app.config.ts`, keeping the production server runnable on Node 20/21:
>
> ```tsx
> import { defineConfig } from 'solidstep';
> import { fileURLToPath } from 'node:url';
>
> const sqliteStub = fileURLToPath(new URL('./sqlite-stub.mjs', import.meta.url));
>
> export default defineConfig({
>   server: {
>     preset: 'node-server',
>     database: {},
>     alias: {
>       'node:sqlite': sqliteStub,
>     },
>   },
> });
> ```
>
> On Node 22.5+ this is unnecessary.

## Docker

A minimal Dockerfile using pnpm:

```dockerfile
FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app

# Install dependencies
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Build the app
COPY . .
RUN pnpm build

ENV PORT=3000
EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
```

> If you deploy on `node:20`/`node:21` images, keep the `node:sqlite` stub described above.

## Related

- [Getting Started](./getting-started.md) — `app.config.ts` configuration.
- [Caching](./caching.md) — page-level caching and response headers.
- [Troubleshooting](./troubleshooting.md) — common deployment/runtime issues.
