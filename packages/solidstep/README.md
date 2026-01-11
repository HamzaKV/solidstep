# SolidStep

Next Solid Step towards a more performant web - A full-stack SolidJS framework for building modern web applications with file-based routing, SSR, and built-in security.

## Features

- 🌟 **Built on SolidJS and Vite** - Leverage the power of SolidJS for reactive and efficient UIs
- 🚀 **File-based Routing** - Automatic routing based on your file structure
- ⚡ **Server-Side Rendering (SSR)** - Fast initial page loads with full SSR support
- 🔄 **Data Loading** - Built-in loaders for efficient data fetching
- 🎨 **Layouts & Groups** - Nested layouts and parallel route groups
- 🛡️ **Security First** - Built-in CSP, CORS, CSRF, and cookie utilities
- 🎯 **Server Actions** - Type-safe server functions with automatic serialization
- ⚙️ **Middleware Support** - Request/response interceptors
- 📦 **Caching** - Built-in page-level caching
- 📝 **TypeScript** - Full TypeScript support out of the box
- 📊 **Built-in Logging** - Configurable Pino logger for logging
- 🌐 **Fetch Utilities** - Type-safe fetch wrappers with timeout and error handling for both client and server

## Getting Started

### Create a New Project

```bash
[npx | yarn dlx | pnpm dlx | bunx] @varlabs/create-solidstep@latest my-app
cd my-app
[npm | yarn | pnpm | bun] install
[npm | yarn | pnpm | bun] run dev
```

### Special Files

- `page.tsx` - Page component
- `layout.tsx` - Layout wrapper
- `loading.tsx` - Loading state (Streaming - optional)
- `error.tsx` - Error boundary (optional)
- `not-found.tsx` - 404 page (root only - optional)
- `route.ts` - API route handler
- `middleware.ts` - Request middleware

**A route is defined by either the presence of a `page.tsx` or `route.ts` file in a directory.**

**Similar to NextJS, routes are not indexed if they have a '_' placed at the beginning of the name**

### Configuration

Configure your app in `app.config.ts`:

```tsx
import { defineConfig } from 'solidstep';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  server: {
    preset: 'node',
  },
  plugins: [
    {
      type: 'client', // or 'server' or 'both' - depends on where you want to use the plugin
      plugin: tailwindcss()
    }
  ],
});
```

#### Vite Configuration

You can customize Vite settings for both client and server builds. 

__When trying to configure absolute path imports__
1. Add the path alias in tsconfig.json (for TypeScript support):
```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./*"]
    }
  }
}
```

2. Then add the same alias in the Vite config inside `app.config.ts` to ensure it works during build and runtime:
```tsx
import { defineConfig } from 'solidstep';
import { resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  server: {
    preset: 'node',
  },
  vite: {
    resolve: {
      alias: {
        '@': resolve(__dirname, '.'),
      },
    },
  },
});
```

### Project Structure

```
my-app/
├── app/
│   ├── page.tsx              # Home page (/)
│   ├── layout.tsx            # Root layout
│   ├── middleware.ts         # Request middleware
│   ├── about/
│   │   └── page.tsx          # About page (/about)
│   ├── (admin)/
│   |   └── dashboard/
│   |       └── page.tsx      # Group route (/dashboard)
│   └── blog/
│       ├── layout.tsx        # Blog layout
│       ├── page.tsx          # Blog index (/blog)
│       └── [slug]/
│           └── page.tsx      # Dynamic route (/blog/:slug)
├── public/
│   └── favicon.ico
├── app.config.ts
└── package.json
```

## Core Concepts

### Layouts

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

### Pages

Create a `page.tsx` file in any directory under `app/` to define a route:

```tsx
export default function HomePage() {
  return <h1>Welcome to SolidStep!</h1>;
}
```

**Similar to NextJS, only content returned by a `page` or `route` is sent to the client**

### Group Routes
Use parentheses to group routes without affecting the URL:

```app/
├── (admin)/
│   └── dashboard/
│       └── page.tsx  // matches /dashboard
└── (user)/
    └── profile/
        └── page.tsx  // matches /profile
```

### Dynamic Routes

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

### Parallel Routes (Groups)

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

### Data Loading

Use `defineLoader` to fetch data on the server:

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

### Server Actions

Create type-safe server functions:

```tsx
'use server';

export const createPost = async (data: { title: string }) => {
  await db.posts.create(data);
  return { success: true };
};
```

Call from client:

```tsx
import { createPost } from './actions';

function CreatePostForm() {
  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    await createPost({ title: 'My Post' });
  };

  return <form onSubmit={handleSubmit}>...</form>;
}
```

### Metadata

Define metadata for SEO:

```tsx
import { meta } from 'solidstep/utils/types';

// can also be async
export const generateMeta = meta(() => {
  return {
    title: {
      type: 'title',
      content: 'My Site',
      attributes: {},
    },
    description: {
      type: 'meta',
      attributes: {
        name: 'description',
        content: 'My awesome site',
      },
    },
    // manifest
    manifest: {
      type: 'link',
      attributes: {
        rel: 'manifest',
        href: '/site.webmanifest',
      },
    },
    // google fonts
    'google-font-link': {
        type: 'link',
        attributes: {
            rel: 'preconnect',
            href: 'https://fonts.googleapis.com'
        }
    },
    'gstatic-font-link': {
        type: 'link',
        attributes: {
            rel: 'preconnect',
            href: 'https://fonts.gstatic.com',
            crossorigin: ''
        }
    },
    'inter-font': {
        type: 'link',
        attributes: {
            rel: 'stylesheet',
            href: 'https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap'
        }
    },
    // external js
    'analytics-script': {
        type: 'script',
        attributes: {
            src: 'analytics.js',
            defer: true,
        }
    }
  };
});
```

### Middleware

Intercept and modify requests:

```tsx
import { defineMiddleware } from 'vinxi/http';

export default defineMiddleware({
  onRequest: async (request) => {
    console.log('Incoming request:', request.url);
    // Modify request if needed
    return request;
  },
});
```

### Page Options

Configure page-level caching:

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

## API Routes

Create REST endpoints:
- GET
- POST
- PUT
- DELETE
- PATCH

```tsx
export async function GET(request: Request, { params }: any) {
  const posts = await fetchPosts();
  return new Response(JSON.stringify(posts), {
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST(request: Request) {
  const data = await request.json();
}
```

## Server Assets
Serve static files from the `server-assets/` directory:

```my-app/
├── server-assets/
│   └── secret.txt
```

Access via `my-app/server-assets/secret.txt` URL:

```ts
const TEMPLATE_PATH = join(process.cwd(), 'server-assets', 'templates', 'template.ejs');
const template = await fs.promises.readFile(TEMPLATE_PATH, 'utf-8');
```

## Utilities

### Cache (Server-Side)
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

### Cookies
```tsx
import { getCookie, setCookie } from 'solidstep/utils/cookies';

export const loader = defineLoader(async () => {
    const userData = await getCookie();

    if (!userData) {
        return [];
    }

    const userId = userData.id;

    const { data, error } = await getDocumentsByUserId(userId);

    if (error || !data) {
        return [];
    }

    return data as Document[];
});

const action = async () => {
    'use server';

    await setCookie('session', JSON.stringify({ id: 'user-id' }), { httpOnly: true, secure: true, maxAge: 3600 });

    return { success: true };
};
```

### CORS
```tsx
import { cors } from 'solidstep/utils/cors';

const trustedOrigins = ['https://example.com', 'https://another-example.com'];

const corsMiddleware = cors(trustedOrigins);

...

const corsHeaders = corsMiddleware(origin, event.node.req.method === 'OPTIONS');

...
```

### CSP
```tsx
import { createBasePolicy, serializePolicy, withNonce } from 'solidstep/utils/csp';

let cspPolicy = createBasePolicy();

...

cspPolicy = withNonce(cspPolicy, nonce);

...

event.response.headers.set('Content-Security-Policy', serializePolicy(cspPolicy));

...
```

### CSRF Protection
```tsx
import { csrf } from 'solidstep/utils/csrf';

const trustedOrigins = ['https://example.com', 'https://another-example.com'];

const csrfMiddleware = csrf(trustedOrigins);

...

const csrfResult = csrfMiddleware(
    event.node.req.method,
    requestUrl,
    origin,
    event.node.req.headers.referer
);

if (!csrfResult.success) {
    event.node.res.statusCode = 403; // Forbidden
    event.node.res.end(csrfResult.message);
    return;
}
```

### Redirects
```tsx
import { redirect } from 'solidstep/utils/redirect';

export const loader = defineLoader(async () => {
  redirect('/login');
});

// or in client
export function MyComponent() {
  const handleClick = () => {
    redirect('/dashboard');
  };

  return <button onClick={handleClick}>Go to Dashboard</button>;
}
```

### Error Handling
```tsx
// first define an error collection
import { createErrorFactory } from 'solidstep/utils/error-handler';

export const createError = createErrorFactory({
    'db-query-error': {
        message: 'Something went wrong with the database query, not idea what',
        severity: 'high',
        action: (error) => {
            console.error('Generic DB query error', error);
            throw error;
        },
    },
    'auth-error': {
        message: 'User authentication failed',
        severity: 'high',
        action: (error) => {
            console.error('User authentication error', error);
            throw error;
        },
    },
    'service-error': {
        message:
            'Some service (external or internal that is interfacing with the app) failed',
        severity: 'high',
        action: (error) => {
            console.error('Service error', error);
            throw error;
        },
    },
});

// then use it in your loaders, actions or routes
export const loader = defineLoader(async () => {
    const data = await tryCatch(fetchDataFromDB());
    if (data.error) {
        // handle the error using the defined error collection
        createError('db-query-error').action();

        // or overwrite the defaults
        createError('db-query-error', {
            // customize the error
            message: data.error.message,
            action: (error) => {
                // just log it for example
                console.error('Custom action for DB error', error);
            },
            severity: 'critical',
            cause: data.error,
            metadata: { query: 'SELECT * FROM users' },
        }).action();

        // defer the definition and the handling
        const error = createError('db-query-error');
        // some logic
        error.action();

        // or throw the error
        const error = createError('db-query-error', {
            cause: data.error,
        });
        throw error;
    }
    return data.result;
});
```

### Logging

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

### Fetch Utilities

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

### Server-Only Code

Ensure code only runs on the server and throws an error if accessed on the client:

```tsx
import 'solidstep/utils/server-only';

export const SECRET_KEY = process.env.SECRET_KEY;
export const DATABASE_URL = process.env.DATABASE_URL;

export async function queryDatabase(query: string) {
}
```

**Use case:** Import this at the top of any file that should never be used for the client (e.g., database utilities, API keys, server secrets).

```tsx
import 'solidstep/utils/server-only';

export const db = createDatabaseConnection(process.env.DATABASE_URL);
```

If accidentally imported on the client, it will throw:
```
Error: This module is only available on the server side.
```

## Preloading/prefetching strategies
SolidStep supports various preloading and prefetching strategies to enhance user experience by loading data and resources ahead of time. This can significantly reduce perceived latency and improve navigation speed within your application. Solidstep does not include any preloading/prefetching by default, but you can implement your own strategies using the built-in fetch utilities and SolidJS features.

Some common strategies include:
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

## Fonts
Install fonts (for example, from [Fontsource](https://github.com/fontsource/fontsource)) and import into `globals.css` example:
```css
@import '@fontsource-variable/dm-sans';
@import '@fontsource-variable/jetbrains-mono';

@theme inline {
  --font-sans: 'DM Sans Variable', sans-serif; 
  --font-mono: 'JetBrains Mono Variable', monospace; 
  /* ... */
}
```

## Images
Use the package called [Unpic](https://unpic.pics/img/solid/) for images. An open source and powerful tool for images on the web.
```bash
[npm | yarn | pnpm | bun] install @unpic/solid
```

```tsx
import type { Component } from "solid-js";
import { Image } from "@unpic/solid";

const MyComponent: Component = () => {
  return (
    <Image
      src="https://cdn.shopify.com/static/sample-images/bath_grande_crop_center.jpeg"
      layout="constrained"
      width={800}
      height={600}
      alt="A lovely bath"
    />
  );
};
```

## Environment Variables
As SolidStep is built using Vite, it follows the same guide as stated in [Vite docs](https://vite.dev/guide/env-and-mode) regarding environment variables.

## Future Plans
- Support for dynamic site.webmanifest, robots.txt, sitemap.xml, manifest.json, and llms.txt
- Support loading and error pages for parallel routes
- Support deferring loaders
- Possible SSG, ISR, and PPR
- Advanced caching strategies
- WebSocket support

## Testing

SolidStep does not include a built-in testing framework. However, we recommend setting up testing using Vitest ecosystem. You can use [Vitest](https://vitest.dev/) for unit and integration tests, and [Playwright](https://playwright.dev/) for end-to-end testing.

### Testing Server Actions

When testing server actions, you can use Vitest to accomplish this. Just test as you would with any other async function.

When testing pages (e2e tests), you can trigger server actions by simulating user interactions that would call those actions. If needed, you can also intercept network requests to directly test the action endpoints. Use the testing framework's capabilities to intercept the requests and ensure the responses have the expected results. If the server action returns json data, stringify it and add it to the response body as well as setting the content-type header to 'application/json'. If the action has a more complex return type, use seroval to serialize the response before sending it back.

## License

MIT

## Links

- [GitHub](https://github.com/HamzaKV/solidstep)
- [SolidJS Documentation](https://www.solidjs.com/)

## Special Mentions
- Inspired by [Remix](https://remix.run/), [Next.js](https://nextjs.org/), and [TanStack](https://tanstack.com/)
- Built with [Vite](https://vitejs.dev/), [SolidJS](https://www.solidjs.com/), [Vinxi](https://github.com/nksaraf/vinxi), [Undici](https://undici.nodejs.org/#/), [Pino](https://getpino.io/#/) and [Seroval](https://github.com/lxsmnsyc/seroval)
