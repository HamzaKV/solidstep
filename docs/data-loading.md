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

Loader caching is independent of [page-level caching](./caching.md): it memoizes just the loader's data and uses the same in-memory store, namespaced under a `loader:` key prefix.

> Loader data caching is in-memory and per-process (like the page cache). A persistent/shared cache is on the roadmap.

## Related

- [Routing](./routing.md) — where loaders live in the file tree.
- [Caching](./caching.md) — cache rendered pages (including loader data).
- [Security](./security.md) — read cookies and redirect from within loaders.
