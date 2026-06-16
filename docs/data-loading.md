# Data Loading

[← Back to docs index](./README.md)

Use `defineLoader` to fetch data on the server. Loaders run on the server before the page renders, and their results are passed to the page (and serialized for client hydration).

```tsx
import { defineLoader, type LoaderDataFromFunction } from 'solidstep/utils/loader';

export const loader = defineLoader(async (request) => {
  const posts = await fetchPosts();
  return { posts };
});

type LoaderData = LoaderDataFromFunction<typeof loader>;

export default function BlogPage(props: { loaderData: LoaderData }) {
  return (
    <ul>
      <For each={props.loaderData.posts}>
        {(post) => <li>{post.title}</li>}
      </For>
    </ul>
  );
}
```

`LoaderDataFromFunction<typeof loader>` infers the return type of your loader so `props.loaderData` is fully typed.

Both `page.tsx` and `layout.tsx` files can export a `loader`. When a page renders, all layout loaders along the route path and the page loader run **concurrently** on the server — see [Architecture](./architecture.md) for details.

## Caching loader data

Pass `options.cache` to `defineLoader` to cache a loader's resolved data on the server, so repeat requests skip the loader body:

```tsx
export const loader = defineLoader(
  async () => {
    const stats = await expensiveQuery();
    return { stats };
  },
  { cache: { ttl: 60_000 } }, // cache for 60s
);
```

- `ttl` — lifetime in milliseconds. `0` or omitted means no expiry (cached for the process lifetime until invalidated).
- `key` — override the cache key. By default the key includes the request `pathname` + search, so the same loader caches **per-URL** (e.g. `/blog/a` and `/blog/b` cache separately). Provide a stable `key` to share one cached value across URLs.

Loader caching is independent of [page-level caching](./caching.md): it memoizes just the loader's data and runs on the **same pluggable `CacheStore`** as the page cache, namespaced under a `loader:` key prefix.

> Loader data caching runs on the active [`CacheStore`](./caching.md#pluggable-cache-stores). The default is an in-memory per-process LRU, but it is **persistent and shared** when you configure a filesystem or external (e.g. Redis) store — the same store backs both the page cache and the loader cache.

## Request context (`locals` & cancellation)

A loader receives a second argument with request-scoped context: the `locals`
your [middleware](./middleware.md) populated on `event.locals`, and a combined
abort `signal`. Forward the signal to `fetch`/DB calls so they cancel when the
client disconnects or the loader times out.

```tsx
export const loader = defineLoader(async (request, { locals, signal }) => {
  const user = locals.user; // set in middleware (e.g. event.locals.user = ...)
  const res = await fetch('https://api.example.com/data', { signal });
  return { data: await res.json() };
});
```

`locals` is typed by the `Locals` interface; augment it for your own keys:

```tsx
declare module 'solidstep/utils/loader' {
  interface Locals {
    user?: { id: string };
  }
}
```

The same `locals` object is passed to page/layout components as the `locals`
prop, so the CSP nonce and your middleware values are available in both places.

## Loader timeouts

Guard against a slow or hung upstream with a timeout. Set it per loader, or a
global default via `defineConfig({ loaderTimeout })`:

```tsx
export const loader = defineLoader(
  async (request, { signal }) => fetchSlowThing({ signal }),
  { timeout: 5_000 }, // ms; overrides the global default. 0 disables it.
);
```

When a loader exceeds its timeout it is aborted and rejects with
`LoaderTimeoutError`. This flows through the usual error isolation: a **page**
loader renders the route's `error.tsx`, while a **layout/group** loader yields
the error sentinel so siblings still render. The timeout's abort is combined with
the request's own signal, so whichever fires first cancels the loader's work.

## Deferred loaders (streaming)

By default a page loader is **sequential**: the page waits for it before any HTML is sent. Mark a page loader `type: 'defer'` to stream the shell **immediately** and stream the loader's data in afterwards — useful for slow, non-critical data.

```tsx
export const loader = defineLoader(
  async () => {
    const feed = await slowFeed(); // slow, non-critical
    return { feed };
  },
  { type: 'defer' },
);
```

A deferred loader is exposed to the page as an **accessor** (a Solid resource) rather than a plain object. Reading it suspends until the data arrives; the framework wraps the page in `<Suspense>` and uses the route's `loading.tsx` as the fallback (a minimal fallback is used if there is none):

```tsx
type LoaderData = LoaderDataFromFunction<typeof loader>;

export default function Page(props: { loaderData: () => LoaderData | undefined }) {
  // Renders loading.tsx until the deferred data streams in.
  return <For each={props.loaderData()?.feed}>{(item) => <li>{item.title}</li>}</For>;
}
```

Under the hood the framework renders deferred routes with Solid's `renderToStream`: the shell (layout chrome + any sequential data) is sent first, then each deferred value streams in and hydrates. Non-deferred routes are unaffected and keep the standard render path.

Notes:
- **Page** and **parallel-route group** (`@slot`) loaders support `defer`. A deferred group renders its own `loading.tsx` while its data streams in, independently of the rest of the page — mark the group's loader `type: 'defer'` and add a `loading.tsx` beside it (see the `@slot` example in [Routing](./routing.md)). Layout loaders are always sequential (a layout must resolve before its subtree renders).
- Deferred data is **streamed** into the HTML on first load and **fetched** on client navigation — either way the route's/group's `loading.tsx` shows until it arrives.
- Deferred routes are **not** page-cached (they're streamed).
- A deferred loader can't issue a redirect (headers are already sent once streaming begins) — redirect from a sequential loader instead.

## Related

- [Routing](./routing.md) — where loaders live in the file tree.
- [Caching](./caching.md) — cache rendered pages (including loader data).
- [Security](./security.md) — read cookies and redirect from within loaders.
