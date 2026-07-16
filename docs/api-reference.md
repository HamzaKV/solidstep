# API Reference

[← Back to docs index](./README.md)

Every public import from the `solidstep` package, mapped to a one-line description and the guide that covers it. These correspond to the `exports` field of the package.

## Core

| Import | Description | Docs |
|--------|-------------|------|
| `solidstep` | `defineConfig` — define your app configuration in `app.config.ts`. | [Getting Started](./getting-started.md#configuration) |

## Components & Hooks

| Import | Description | Docs |
|--------|-------------|------|
| `solidstep/form` | `Form` component for submitting forms to server actions (with progressive enhancement). | [Server Actions & Forms](./server-actions-and-forms.md#form-actions) |
| `solidstep/hooks/action-state` | `useActionState` — track form action state, pending, and errors. | [Server Actions & Forms](./server-actions-and-forms.md#form-actions) |
| `solidstep/hooks/form-status` | `useFormStatus` — read the pending status of the enclosing `<Form>`. | [Server Actions & Forms](./server-actions-and-forms.md#form-actions) |
| `solidstep/client-only` | `<ClientOnly>` — a JSX boundary that renders `children()` only after client mount, never during SSR/hydration. | [Client-Only Rendering](./client-only.md) |
| `solidstep/utils/client-only` | `clientOnly(component, {fallback})` — a HOC that lazy-loads and renders a component client-side only, showing `fallback` during SSR/pre-mount. | [Client-Only Rendering](./client-only.md) |

## Data & Metadata

| Import | Description | Docs |
|--------|-------------|------|
| `solidstep/utils/loader` | `defineLoader` and `LoaderDataFromFunction` for server data loading. | [Data Loading](./data-loading.md) |
| `solidstep/utils/meta` | `meta()` — wrap a `generateMeta` function for SEO/`<head>` metadata. | [Metadata](./metadata.md) |
| `solidstep/utils/metadata` | `sitemap()` / `robots()` body helpers for dynamic metadata files. | [Metadata Files](./metadata-files.md) |
| `solidstep/utils/options` | Types/helpers for page `options` (cache, response headers). | [Caching](./caching.md) |

## Server Lifecycle

| Import | Description | Docs |
|--------|-------------|------|
| `solidstep/utils/middleware` | `defineMiddleware` and the `Middleware` type for request/response interceptors. | [Middleware](./middleware.md) |
| `solidstep/utils/instrumentation` | `defineInstrumentation` — server-wide observability/telemetry hooks. | [Instrumentation](./instrumentation.md) |
| `solidstep/utils/cache` | `invalidateCache`, `invalidateTag`, `revalidatePath` for cache invalidation, and `setCacheStore` to plug in a backend. | [Caching](./caching.md) |
| `solidstep/utils/cache-store` | `CacheStore`/`CacheEntry` types and the `MemoryCacheStore`/`FilesystemCacheStore` adapters. | [Caching](./caching.md#pluggable-cache-stores) |
| `solidstep/utils/prerender` | `GenerateStaticParams` type for `generateStaticParams` exports (SSG/ISR). | [Rendering](./rendering.md) |
| `solidstep/utils/redirect` | `redirect()` — redirect from loaders, actions, or the client. | [Security](./security.md#redirects) |
| `solidstep/utils/error-handler` | `createErrorFactory` — define and handle typed error collections. | [Security](./security.md#error-handling) |

## Security

| Import | Description | Docs |
|--------|-------------|------|
| `solidstep/utils/cookies` | `getCookie` / `setCookie` for reading and writing cookies. | [Security](./security.md#cookies) |
| `solidstep/utils/cors` | `cors()` — build CORS headers from a trusted-origins list. | [Security](./security.md#cors) |
| `solidstep/utils/csp` | `createBasePolicy`, `withNonce`, `serializePolicy` for Content Security Policy. | [Security](./security.md#csp) |
| `solidstep/utils/csrf` | `csrf()` — CSRF protection middleware. | [Security](./security.md#csrf-protection) |
| `solidstep/utils/server-only` | Side-effect import that throws if a module is loaded on the client. | [Security](./security.md#server-only-code) |

## Utilities

| Import | Description | Docs |
|--------|-------------|------|
| `solidstep/utils/logger` | `logger` — built-in Pino logger instance. | [Utilities](./utilities.md#logging) |
| `solidstep/utils/fetch.client` | Type-safe client-side `fetch` wrapper with timeout and error handling. | [Utilities](./utilities.md#fetch-utilities) |
| `solidstep/utils/fetch.server` | Type-safe server-side `fetch` wrapper (undici) with timeout and error handling. | [Utilities](./utilities.md#fetch-utilities) |

## See Also

- [Architecture](./architecture.md) — how these pieces fit together at runtime.
- [Docs index](./README.md) — full table of contents.
