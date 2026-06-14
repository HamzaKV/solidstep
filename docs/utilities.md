# Utilities

[← Back to docs index](./README.md)

## Logging

SolidStep includes a built-in Pino logger that can be configured globally:

```tsx
import { defineConfig } from 'solidstep';

export default defineConfig({
  server: {
    preset: 'node',
  },
  logger: {
    level: 'info',
    transport: {
      target: 'pino-pretty', // Use pino-pretty for human-readable logs
      options: {
        colorize: true
      }
    }
  }
});
```

Use the logger in your code:

```tsx
import { logger } from 'solidstep/utils/logger';

export const loader = defineLoader(async () => {
  logger.info('Fetching posts');
  
  try {
    const posts = await fetchPosts();
    logger.info(`Fetched ${posts.length} posts`);
    return { posts };
  } catch (error) {
    logger.error('Failed to fetch posts', error);
    throw error;
  }
});
```

**Logger Configuration Options:**
- `false` or `undefined` - Disables logging (silent mode)
- `true` - Enables default Pino logger
- `object` - Custom Pino configuration object [Pino Docs](https://getpino.io/#/docs/api?id=options)

> The resolved logger configuration is written to a generated `.config.json` in the server build — see [Deployment](./deployment.md).

## Fetch Utilities

SolidStep provides type-safe fetch wrappers for both client and server with built-in timeout and error handling:

**Client-side Fetch:**
```tsx
import fetch from 'solidstep/utils/fetch.client';

async function fetchPosts() {
  const posts = await fetch<Post[]>('/api/posts', {
    method: 'GET',
    MAX_FETCH_TIME: 5000,
  });
  
  return posts;
}

...

// To get full response including status, headers, etc.
const response = await fetch<Post[], false>(
  '/api/posts',
  { method: 'GET' },
  false
);

console.log(response.status); // HTTP status code
```

**Server-side Fetch:**
```tsx
import fetch from 'solidstep/utils/fetch.server';

export const loader = defineLoader(async () => {
  const data = await fetch<ApiResponse>('https://api.example.com/data', {
    method: 'POST',
    body: JSON.stringify({ query: 'test' }),
    headers: {
      'Content-Type': 'application/json',
    },
    MAX_FETCH_TIME: 10000,
  });
  
  return data;
});
```

**Features:**
- Automatic timeout handling with AbortController (default: 4000ms)
- Automatic JSON parsing (optional)
- Error handling for HTTP 4xx/5xx responses
- Type-safe responses with TypeScript generics
- Server-side uses undici for better performance

## Preloading / Prefetching Strategies

SolidStep supports various preloading and prefetching strategies to enhance user experience by loading data and resources ahead of time. This can significantly reduce perceived latency and improve navigation speed within your application.

The router has prefetching built in. The [`<Link>`](./routing.md#link) component prefetches a route's data and component modules on hover by default (configurable via `prefetch="viewport" | true | false`), and you can prefetch imperatively with [`prefetchRoute(target)`](./routing.md#programmatic-navigation--router-hooks) from `solidstep/router`. See [Client Navigation](./routing.md#client-navigation) for the full API.

You can also layer additional strategies on top using the built-in fetch utilities and SolidJS features. Some common ones include:
- **Link Prefetching**: Use the `<link rel="prefetch">` tag to hint the browser to prefetch resources for links that users are likely to click on next.
- **Using Intersection Observer**: Implement lazy loading and prefetching of data when certain elements come into the viewport.
- **Using [instant.page](https://instant.page/)**: A small library that preloads pages on hover or touchstart events.
```tsx
export const RootLayout = (props) => {
  return (
    <body>
      ...
      <NoHydration>
      <script src="//instant.page/5.2.0" type="module" integrity="sha384-jnZyxPjiipYXnSU0ygqeac2q7CVYMbh84q0uHVRRxEtvFPiQYbXWUorga2aqZJ0z"></script>
      </NoHydration>
    </body>
  );
};
```
- **Using [Foresight.js](https://foresightjs.com/)**: A library that preloads pages based on user behavior and patterns.
```tsx
import { ForesightManager } from "js.foresight";
import { onMount } from "solid-js";

export const RootLayout = (props) => {
  onMount(() => {
    ForesightManager.initialize({
      // Configuration options
    });
  });
  return (
    <body>
      ...
    </body>
  );
};
```
- **Custom Preloading Logic**: Write custom logic to preload data for specific routes or components based on user behavior or application state.

## Related

- [Instrumentation](./instrumentation.md) — server-wide observability hooks.
- [API Routes](./api-routes.md) — endpoints to fetch from.
- [Data Loading](./data-loading.md) — server-side data fetching.
