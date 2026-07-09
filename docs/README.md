# SolidStep Documentation

Next Solid Step towards a more performant web — a full-stack SolidJS framework for building modern web applications with file-based routing, SSR, and built-in security.

This is the documentation index. Pages are grouped into **Guides**, **Reference**, and **Operations**.

## Guides

- [Getting Started](./getting-started.md) — create a project, special files, configuration, project structure.
- [Routing](./routing.md) — pages, layouts, group routes, dynamic routes, parallel routes.
- [Data Loading](./data-loading.md) — `defineLoader`, typed loader data, request context, timeouts.
- [Data Validation](./data-validation.md) — validating params/form data with Standard Schema (Zod/Valibot/ArkType).
- [Rendering Strategies](./rendering.md) — SSG / ISR / dynamic via `render`, `generateStaticParams`.
- [Server Actions & Forms](./server-actions-and-forms.md) — server functions, `<Form>`, `useActionState`, `useFormStatus`, progressive enhancement.
- [Metadata](./metadata.md) — SEO metadata with `generateMeta` / `meta()`.
- [Metadata Files](./metadata-files.md) — dynamic `robots.txt`, `sitemap.xml`, `manifest`, `llms.txt`.
- [Middleware](./middleware.md) — request/response interceptors with `defineMiddleware`.
- [Instrumentation](./instrumentation.md) — observability hooks and OpenTelemetry.
- [Caching](./caching.md) — page-level caching and cache invalidation.
- [API Routes](./api-routes.md) — REST endpoints with `route.ts`, SSE/streaming, server assets.
- [Database & ORM](./database.md) — Drizzle/Prisma patterns and connection lifecycle.
- [Performance](./performance.md) — rendering strategy, caching, streaming, metrics, bundle analysis.
- [Security](./security.md) — cookies, CORS, CSP, CSRF, redirects, error handling, server-only code.
- [Utilities](./utilities.md) — logging, fetch wrappers, preloading/prefetching strategies.
- [Assets & Environment](./assets-and-env.md) — fonts, images, environment variables.

## Reference

- [Architecture](./architecture.md) — request lifecycle, manifest, render strategies, streaming/deferred/PPR, soft navigation, hydration, server-action serialization.
- [API Reference](./api-reference.md) — every public `solidstep/...` import mapped to a description and docs page.
- [Testing](./testing.md) — unit testing with Vitest, testing loaders/actions/components, and end-to-end testing with Playwright.
- [Troubleshooting](./troubleshooting.md) — common issues and fixes.

## Operations

- [Deployment](./deployment.md) — building, Nitro presets, env vars, Docker, Node requirements.
- [Roadmap](./roadmap.md) — planned features and direction.

## Links

- [llms.txt](./llms.txt) — machine-readable docs index for AI agents.
- [GitHub](https://github.com/HamzaKV/solidstep)
- [SolidJS Documentation](https://www.solidjs.com/)
