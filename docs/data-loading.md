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

## Related

- [Routing](./routing.md) — where loaders live in the file tree.
- [Caching](./caching.md) — cache rendered pages (including loader data).
- [Security](./security.md) — read cookies and redirect from within loaders.
