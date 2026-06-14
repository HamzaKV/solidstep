# SolidStep

> Next Solid Step towards a more performant web

SolidStep is a full-stack meta SSR framework for [SolidJS](https://www.solidjs.com/) for building modern web applications. It pairs file-based routing with server-side rendering and a range of rendering strategies — SSR, SSG, ISR, and PPR — plus streaming via deferred loaders, type-safe server actions, typed routes, and security primitives, all with TypeScript out of the box.

Built on [Vite](https://vitejs.dev/), [Vinxi](https://github.com/nksaraf/vinxi), and [Nitro](https://nitro.build/), and inspired by [Next.js](https://nextjs.org/), [Remix](https://remix.run/), and [TanStack](https://tanstack.com/).

## Quick start

Scaffold a new app with the `create-solidstep` CLI:

```bash
# npm
npm create @varlabs/solidstep@latest my-app

# pnpm
pnpm create @varlabs/solidstep@latest my-app

# or run the CLI directly
npx @varlabs/create-solidstep@latest my-app
```

Then install dependencies and start the dev server:

```bash
cd my-app
pnpm install
pnpm dev
```

The project scripts wrap Vinxi:

```bash
pnpm dev      # vinxi dev   — start the dev server
pnpm build    # vinxi build — build for production (outputs .output/)
pnpm start    # vinxi start — run the production server
```

Requires **Node >= 20**. See [Getting Started](docs/getting-started.md) for project structure, special files, and configuration.

## A minimal example

A route is defined by a `page.tsx` (or `route.ts`) inside the `app/` directory. Pages can export a `loader` that runs on the server before the page renders; its data is passed to the page as `loaderData` and serialized for client hydration.

```tsx
// app/page.tsx
import { defineLoader, type LoaderDataFromFunction } from 'solidstep/utils/loader';

export const loader = defineLoader(async () => {
  return { message: 'hello from the home loader' };
});

type LoaderData = LoaderDataFromFunction<typeof loader>;

export default function HomePage(props: { loaderData: LoaderData }) {
  return (
    <section>
      <h1>SolidStep</h1>
      <p>{props.loaderData.message}</p>
    </section>
  );
}
```

`LoaderDataFromFunction<typeof loader>` infers the loader's return type, so `props.loaderData` is fully typed. See [Data Loading](docs/data-loading.md) for caching and deferred (streaming) loaders.

## Features

| Feature | Description |
| --- | --- |
| [Routing](docs/routing.md) | File-based pages, nested layouts, group routes, dynamic and parallel routes |
| [Data Loading](docs/data-loading.md) | `defineLoader` with typed loader data, loader caching, and deferred streaming |
| [Rendering Strategies](docs/rendering.md) | SSG / ISR / dynamic via `render` and `generateStaticParams` |
| [Server Actions & Forms](docs/server-actions-and-forms.md) | Type-safe server functions, `<Form>`, `useActionState`, `useFormStatus`, progressive enhancement |
| [Caching](docs/caching.md) | Page-level caching and cache invalidation with a pluggable cache store |
| [Middleware](docs/middleware.md) | Request/response interceptors with `defineMiddleware` |
| [Security](docs/security.md) | Cookies, CORS, CSP, CSRF, redirects, error handling, and server-only code |
| [Metadata](docs/metadata.md) | SEO metadata via `generateMeta` / `meta()`, plus [metadata files](docs/metadata-files.md) (`robots.txt`, `sitemap.xml`, `manifest`, `llms.txt`) |
| [API Routes](docs/api-routes.md) | REST endpoints with `route.ts` and server assets |
| [Instrumentation](docs/instrumentation.md) | Observability hooks and OpenTelemetry |
| [Utilities](docs/utilities.md) | Configurable Pino logging, type-safe fetch wrappers, preloading/prefetching |

## Deploy targets

The deployment target is a Nitro preset set via `server.preset` in `app.config.ts`. The starter template uses the Node presets (`node`, `node-server`); other Nitro presets mentioned in the docs include:

- `vercel`
- `cloudflare` (and `cloudflare-pages` / `cloudflare-module`)
- `netlify`
- `azure-functions`

See [Deployment](docs/deployment.md) for builds, Docker, environment variables, and the full Node setup.

## Examples

- [`examples/kitchen-sink`](examples/kitchen-sink) — a comprehensive example app exercising routing, layouts, dynamic/parallel routes, server actions, caching, deferred streaming, SSG/ISR/PPR, metadata files, and more.

## Docs

Full documentation lives in [`docs/`](docs/README.md). Start at the [documentation index](docs/README.md).

## License

[MIT](LICENSE)
