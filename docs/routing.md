# Routing

[← Back to docs index](./README.md)

SolidStep uses file-based routing. A route is defined by the presence of a `page.tsx` (rendered route) or `route.ts` ([API route](./api-routes.md)) file in a directory under `app/`.

## Pages

Create a `page.tsx` file in any directory under `app/` to define a route:

```tsx
export default function HomePage() {
  return <h1>Welcome to SolidStep!</h1>;
}
```

**Similar to NextJS, only content returned by a `page` or `route` is sent to the client**

## Layouts

Wrap multiple pages with shared UI:

```tsx
export default function BlogLayout(props: { children: any }) {
  return (
    <div>
      <nav>Blog Navigation</nav>
      {props.children()}
    </div>
  );
}
```

Layouts nest along the route path — a layout at `app/blog/layout.tsx` wraps every route under `/blog`.

## Group Routes

Use parentheses to group routes without affecting the URL:

```
app/
├── (admin)/
│   └── dashboard/
│       └── page.tsx  // matches /dashboard
└── (user)/
    └── profile/
        └── page.tsx  // matches /profile
```

## Dynamic Routes

Use square brackets for dynamic segments:

```tsx
// app/blog/[slug]/page.tsx - matches /blog/my-post, /blog/another-post, etc.

export default function BlogPost(props: { routeParams: { slug: string } }) {
  return <h1>Post: {props.routeParams.slug}</h1>;
}
```

**Catch-all routes:**
```tsx
// app/docs/[...path]/page.tsx - matches /docs/a, /docs/a/b, etc.
```

**Catch-all routes (Optional):**
```tsx
// app/docs/[[...path]]/page.tsx - matches /docs, /docs/a, /docs/a/b, etc.
```

## Parallel Routes (Groups)

Render multiple sections simultaneously:

```
app/
├── layout.tsx
├── page.tsx
└── @graph1/
    └── page.tsx
└── @graph2/
    └── page.tsx
```

```tsx
export default function RootLayout(props: { 
  children: any;
  slots: { graph1: any; graph2: any; };
}) {
  return (
    <main>
      {props.children()}
      <aside>
        <div>{props.slots.graph1()}</div>
        <div>{props.slots.graph2()}</div>
      </aside>
    </main>
  );
}
```

### Per-group loading & error boundaries

A `@group` directory may include its own `loading.tsx` and/or `error.tsx`:

```
app/dashboard/
├── layout.tsx
├── page.tsx
└── @analytics/
    ├── page.tsx
    ├── loading.tsx   # shown while this slot's deferred data streams in
    └── error.tsx     # shown if this slot's loader or render throws
```

- **`error.tsx`** isolates a slot: if that group's loader rejects or its component throws, only that slot renders its `error.tsx` (it receives the `error` as a prop) — sibling slots and the page render normally. The route is streamed (`renderToStream`) so the error hydrates consistently.
- **`loading.tsx`** is the `<Suspense>` fallback for a group whose loader is [deferred](./data-loading.md#deferred-loaders-streaming): the slot shows it until the data streams in. The group page reads its loader data as an accessor, exactly like a deferred page loader.

A group with neither boundary nor a deferred loader behaves as before (its loader is awaited and the slot renders synchronously with the rest of the page).

## Client Navigation

SolidStep ships a client-side router. After the initial SSR + hydration, in-app navigations are **soft navigations**: instead of a full page reload, the router fetches the target route's resolved loader data + metadata as a serialized envelope, then swaps only the route segments that changed. The root layout stays mounted, so layout-level state (open menus, scroll containers, etc.) is preserved.

### `<Link>`

Use `<Link>` (from `solidstep/link`) for navigation. It renders a real `<a href>` — so it works without JavaScript and respects modifier-clicks, `target`, `download`, `rel="external"`, and external origins — and intercepts plain same-origin left-clicks to navigate softly.

```tsx
import { Link } from 'solidstep/link';

<Link href="/about">About</Link>
<Link href="/blog/hello" prefetch="viewport" replace scroll={false}>
  Hello
</Link>
```

- `prefetch` — when to warm the target's data + component modules:
  - `'hover'` *(default)* — on mouse enter / focus.
  - `'viewport'` — when the link scrolls into view (via `IntersectionObserver`).
  - `true` — eagerly on mount.
  - `false` — never.
- `replace` — replace the current history entry instead of pushing a new one.
- `scroll` — scroll to top after navigating (default `true`; ignored for `#hash` links, which scroll to the target element).

Prefetched envelopes are cached briefly (30s) and de-duplicated, so prefetch is safe to use liberally.

### Programmatic navigation & router hooks

All of the following are exported from `solidstep/router`:

```tsx
import {
  useNavigate,
  usePathname,
  useSearchParams,
  useRouter,
  navigationPending,
  prefetchRoute,
} from 'solidstep/router';

const navigate = useNavigate();
await navigate('/dashboard');                 // soft navigate
await navigate('/login', { replace: true });  // replace history entry

const pathname = usePathname();         // reactive accessor: () => string
const searchParams = useSearchParams(); // reactive accessor: () => Record<string, string>

prefetchRoute('/blog/hello');           // manually warm a route's data + modules
```

- **`useNavigate()`** returns the imperative `navigate(href, { replace?, scroll? })`. External, non-page, and failed requests transparently fall back to a full-page navigation.
- **`usePathname()` / `useSearchParams()`** return reactive accessors for the current location.
- **`navigationPending`** is a reactive signal that is `true` while a navigation's data is in flight — use it to show a global loading indicator.
- **`useRouter()`** returns the full router API: `{ route, navigate, refresh, pending }`.

### Revalidating after a mutation

To re-run the current route's loaders and update the page **in place** (without remounting components or losing their local state), call `refresh()`:

```tsx
import { useRouter } from 'solidstep/router';

const { refresh } = useRouter();

const onSave = async () => {
  await saveProfile(formData); // your server action
  await refresh();             // re-fetch this route's loader data + metadata
};
```

This is wired automatically for server actions: calling [`revalidatePath(path)`](./caching.md) inside a server action sets a response header that the client reads — when `path` matches the current route, the router calls `refresh()` for you, so the page reflects the mutation without a manual call or a full reload. See [Server Actions & Forms](./server-actions-and-forms.md).

## Related

- [Data Loading](./data-loading.md) — load data per page/layout.
- [Metadata](./metadata.md) — set per-route `<head>` metadata.
- [Caching](./caching.md) — page-level caching options.
- [Architecture](./architecture.md) — how routes are matched and rendered.
