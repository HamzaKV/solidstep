# SolidStep

Next Solid Step towards a more performant web - A full-stack SolidJS framework for building modern web applications with file-based routing, SSR, and built-in security.

## Features

- 🌟 **Built on SolidJS and Vite** - Leverage the power of SolidJS for reactive and efficient UIs
- 🚀 **File-based Routing** - Automatic routing based on your file structure
- ⚡ **Server-Side Rendering (SSR)** - Fast initial page loads with full SSR support
- 🔄 **Data Loading** - Built-in loaders for efficient data fetching
- 🎨 **Layouts & Groups** - Nested layouts and parallel route groups
- 🛡️ **Security First** - Built-in CSP, CORS, CSRF, and cookie utilities
- 🎯 **Server Actions** - Type-safe server functions with automatic serialization
- ⚙️ **Middleware Support** - Request/response interceptors
- 📦 **Caching** - Built-in page-level caching
- 📝 **TypeScript** - Full TypeScript support out of the box
- 📊 **Built-in Logging** - Configurable Pino logger for logging
- 🌐 **Fetch Utilities** - Type-safe fetch wrappers with timeout and error handling for both client and server

## Quick Start

```bash
[npx | yarn dlx | pnpm dlx | bunx] @varlabs/create-solidstep@latest my-app
cd my-app
[npm | yarn | pnpm | bun] install
[npm | yarn | pnpm | bun] run dev
```

This scaffolds a new SolidStep app and starts the dev server. Requires **Node >= 20**.

## Documentation

Full documentation lives in the [`docs/`](https://github.com/HamzaKV/solidstep/tree/main/docs) directory of the GitHub repository.

**Guides**

- [Getting Started](https://github.com/HamzaKV/solidstep/blob/main/docs/getting-started.md) — create a project, special files, configuration, project structure.
- [Routing](https://github.com/HamzaKV/solidstep/blob/main/docs/routing.md) — pages, layouts, group routes, dynamic & parallel routes.
- [Data Loading](https://github.com/HamzaKV/solidstep/blob/main/docs/data-loading.md) — `defineLoader` and typed loader data.
- [Server Actions & Forms](https://github.com/HamzaKV/solidstep/blob/main/docs/server-actions-and-forms.md) — server functions, `<Form>`, `useActionState`, `useFormStatus`.
- [Metadata](https://github.com/HamzaKV/solidstep/blob/main/docs/metadata.md) — SEO metadata with `generateMeta` / `meta()`.
- [Middleware](https://github.com/HamzaKV/solidstep/blob/main/docs/middleware.md) — request/response interceptors.
- [Instrumentation](https://github.com/HamzaKV/solidstep/blob/main/docs/instrumentation.md) — observability hooks and OpenTelemetry.
- [Caching](https://github.com/HamzaKV/solidstep/blob/main/docs/caching.md) — page-level caching and invalidation.
- [API Routes](https://github.com/HamzaKV/solidstep/blob/main/docs/api-routes.md) — REST endpoints and server assets.
- [Security](https://github.com/HamzaKV/solidstep/blob/main/docs/security.md) — cookies, CORS, CSP, CSRF, redirects, error handling, server-only code.
- [Utilities](https://github.com/HamzaKV/solidstep/blob/main/docs/utilities.md) — logging, fetch wrappers, preloading strategies.
- [Assets & Environment](https://github.com/HamzaKV/solidstep/blob/main/docs/assets-and-env.md) — fonts, images, environment variables.

**Reference & Operations**

- [Architecture](https://github.com/HamzaKV/solidstep/blob/main/docs/architecture.md) — request lifecycle, streaming SSR, hydration, serialization.
- [API Reference](https://github.com/HamzaKV/solidstep/blob/main/docs/api-reference.md) — every public `solidstep/...` import.
- [Deployment](https://github.com/HamzaKV/solidstep/blob/main/docs/deployment.md) — building, Nitro presets, Docker, Node requirements.
- [Troubleshooting](https://github.com/HamzaKV/solidstep/blob/main/docs/troubleshooting.md) — common issues and fixes.

Start at the [documentation index](https://github.com/HamzaKV/solidstep/blob/main/docs/README.md).

## License

MIT

## Links

- [GitHub](https://github.com/HamzaKV/solidstep)
- [SolidJS Documentation](https://www.solidjs.com/)

## Special Mentions

- Inspired by [Remix](https://remix.run/), [Next.js](https://nextjs.org/), and [TanStack](https://tanstack.com/)
- Built with [Vite](https://vitejs.dev/), [SolidJS](https://www.solidjs.com/), [Vinxi](https://github.com/nksaraf/vinxi), [Undici](https://undici.nodejs.org/#/), [Pino](https://getpino.io/#/) and [Seroval](https://github.com/lxsmnsyc/seroval)
