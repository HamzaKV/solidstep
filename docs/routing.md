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

## Related

- [Data Loading](./data-loading.md) — load data per page/layout.
- [Metadata](./metadata.md) — set per-route `<head>` metadata.
- [Caching](./caching.md) — page-level caching options.
- [Architecture](./architecture.md) — how routes are matched and rendered.
