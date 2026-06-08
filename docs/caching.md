# Caching

[← Back to docs index](./README.md)

## Page Options

Configure page-level caching by exporting an `options` object from a `page.tsx`:

```tsx
export const options = {
  cache: {
    ttl: 60000, // Cache for 60 seconds
  },
  responseHeaders: { // Custom headers for pages
    'X-Custom-Header': 'MyValue',
    'Cache-Control': 'public, max-age=60', // Client-side caching
  },
};
```

- Regarding caching, setting `ttl` to `0` or omitting it will disable caching for that page.
  - Setting a positive integer value will cache the page for that duration in milliseconds.
  - Invalidation of cached pages can be done using the `invalidateCache` and `revalidatePath` utilities.
- The `responseHeaders` option allows you to set custom HTTP headers for the page response.

## Cache (Server-Side)

- Every page can be cached by setting the `options.cache` property in the page.
- You can also manually invalidate the cache for specific routes.
- Invalidation can be done in two ways:

1. Using the `invalidateCache` utility to only invalidate paths.
```tsx
import { invalidateCache } from 'solidstep/utils/cache';

const action = async () => {
    'use server';

    ...

    // Invalidate cache after data mutation
    await invalidateCache('/some-route');

    ...

    return { success: true };
};
```

2. Using the `revalidatePath` utility to revalidate specific paths and revalidate the frontend DOM - signaling the server action as a Single Flight Mutation query.
```tsx
import { revalidatePath } from 'solidstep/utils/cache';

const action = async () => {
    'use server';

    ...

    // Revalidate path after data mutation
    await revalidatePath('/some-route');

    ...

    return { success: true };
};
```

## Related

- [Server Actions & Forms](./server-actions-and-forms.md) — where you typically call `invalidateCache` / `revalidatePath`.
- [Data Loading](./data-loading.md) — cached renders include loader data.
- [Troubleshooting](./troubleshooting.md#cache-not-invalidating) — if a cached page isn't refreshing.
