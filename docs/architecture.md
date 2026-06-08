# Architecture

[← Back to docs index](./README.md)

A high-level overview of how a SolidStep request is handled, from URL to hydrated page. This page describes internals to help you reason about behavior; the public API is documented in the [guides](./README.md#guides).

## Request Lifecycle

```
Request
  → middleware (onRequest)
  → match route against the manifest
  → API route handler        (route.ts) ──► Response
  → page render (streaming SSR)           ──► HTML stream
  → middleware (onBeforeResponse)
  → Response
```

Instrumentation hooks (`onRequest`, `onResponseEnd`, `onRequestError`) wrap this flow — see [Instrumentation](./instrumentation.md).

## 1. Route Manifest

At server startup, SolidStep builds an in-memory route manifest from Vinxi's file routes (`vinxi/routes`). It walks every discovered file, classifies each as a `route` (API), `layout`, `loading`, `error`, `not-found`, or `group` (parallel `@slot`), and assembles a trie of route nodes via `insertRoute` (see `utils/path-router.ts` and `utils/router.ts`).

For each page route it precomputes the chain of nested layouts (root → leaf), the matching `loading` and `error` pages, the root `not-found` page, and any parallel-route groups attached to that path. API routes (`route.ts`) are inserted as `route`-type nodes carrying their handler import.

The manifest is built once and reused. In production, dynamically imported route modules are additionally memoized in a module cache; in dev the cache is skipped so HMR invalidations are respected.

## 2. Matching

For each incoming request, `matchRoute(manifest, pathname)` walks the trie and returns the matched handler plus extracted `params` (including dynamic `[slug]`, catch-all `[...path]`, and optional catch-all `[[...path]]` segments). Requests to `_server` are routed to the server-action handler; certain well-known paths short-circuit.

- If the match is an **API route**, the corresponding method export (`GET`/`POST`/...) is invoked and its `Response` is returned directly.
- If the match is a **page**, rendering proceeds (next section).
- If there is **no match**, the root `not-found` page is rendered with a `404` status.

## 3. Rendering with Parallel Loaders

The `render()` function (in `server.ts`) resolves the page variant to render (`main`, `loading`, `error`, or `not-found`). It then runs **every layout loader along the route path and the page loader concurrently** (`Promise.all`) rather than sequentially down the layout chain. Results are keyed by each node's manifest path and applied in tree order, so `loaderData` ordering is deterministic while the awaits overlap. Parallel-route group loaders run alongside the last layout.

Layouts and the page are composed inside-out (`reduceRight`) into a single component tree, metadata from each node is merged, and per-module CSS/asset lists are collected from the client manifest. The tree is rendered to a string with `renderToString` from `solid-js/web`.

## 4. Streaming SSR

The page response is a `ReadableStream`. When a `loading.tsx` exists for the route, SolidStep streams in stages:

1. **loading** — the loading variant is rendered and pushed first, with a hydration script targeting the loading page, so the user sees content immediately.
2. **main** — the full page is then rendered; a script swaps the document head and body to the final content and triggers hydration of the main page.
3. **error** — if rendering throws and an `error.tsx` exists, the error variant is rendered with a `500` status (a thrown `RedirectError` instead produces a `302` with a `Location` header).

Each stage emits a hydration script that imports the client entry and calls `main(manifestPath, params, searchParams, loaderData)`, passing the server-resolved loader data so the client does not re-fetch. Rendered `main` responses may be cached per path according to the page's [cache options](./caching.md).

## 5. Client Hydration

The client entry (`client.ts`) exposes `main(...)`. Given the module path, it reconstructs the same layout chain and parallel-route groups from `vinxi/routes`, rehydrates each node with the loader data passed from the server, composes the tree, and calls `hydrate()` from `solid-js/web` against the document. It also handles single-flight mutation revalidation by re-applying a DOM diff on page show when a path was revalidated.

## 6. Server-Action Serialization

Server actions (`'use server'`) are invoked over the network at the `_server` endpoint. Arguments and return values are (de)serialized with [seroval](https://github.com/lxsmnsyc/seroval) using a shared plugin set (`utils/serialize.ts`) that supports `FormData`, `Headers`, `Request`/`Response`, `URL`, `ReadableStream`, and more.

Values are **cross-serialized into a chunked `ReadableStream`** (`serializeToStream`): each frame is length-prefixed with a 12-byte header (`;0x<8 hex digits>;`) followed by the UTF-8 payload. The first chunk carries the cross-reference header so references that arrive in later chunks (e.g. streamed promises or readable streams) resolve correctly. The receiving side (`SerovalChunkReader`) buffers partial reads until a full frame is available, then deserializes it. This streaming format is what lets server actions return complex/async values — and is why returning plain values that aren't seroval-serializable can surprise you (see [Troubleshooting](./troubleshooting.md#server-action-returning-unexpected-types)).

## Related

- [Routing](./routing.md) — the file conventions that feed the manifest.
- [Data Loading](./data-loading.md) — authoring loaders.
- [Caching](./caching.md) — page caching and revalidation.
- [Instrumentation](./instrumentation.md) — observing the lifecycle.
