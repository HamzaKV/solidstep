# SolidStep

Next Solid Step towards a more performant web - A full-stack SolidJS framework for building modern web applications with file-based routing, SSR, and built-in security.

## Features

- 🚀 **File-based Routing** - Automatic routing based on your file structure
- ⚡ **Server-Side Rendering (SSR)** - Fast initial page loads with full SSR support
- 🔄 **Data Loading** - Built-in loaders for efficient data fetching
- 🎨 **Layouts & Groups** - Nested layouts and parallel route groups
- 🛡️ **Security First** - Built-in CSP, CORS, CSRF, and cookie utilities
- 🎯 **Server Actions** - Type-safe server functions with automatic serialization
- ⚙️ **Middleware Support** - Request/response interceptors
- 📦 **Caching** - Built-in page-level caching
- 🔥 **Hot Module Replacement** - Fast development experience
- 📝 **TypeScript** - Full TypeScript support out of the box

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

### Configuration

Configure your app in `app.config.ts`:

```tsx
import { defineConfig } from 'solidstep';

export default defineConfig({
  server: {
    preset: 'node',
  },
  plugins: [
    {
      type: 'both',
      plugin: myVitePlugin(),
    },
  ],
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
    <div>
      <main>
        {props.children()}
        <aside>
          <div>{props.slots.graph1()}</div>
          <div>{props.slots.graph2()}</div>
        </aside>
      </main>
    </div>
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
import type { Meta } from 'solidstep/utils/types';

export const generateMeta = async () => {
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
  } satisfies Meta;
};
```

### Middleware

Intercept and modify requests:

```tsx
import { eventHandler } from 'vinxi/http';

export default eventHandler((event) => {
  event.locals = { user: getCurrentUser() };

  // you can also modify request/response here
  // also include cors, csrf, csp logic if needed
});
```

### Page Options

Configure page-level caching:

```tsx
export const options = {
  cache: {
    ttl: 60000,
  },
};
```

## API Routes

Create REST endpoints:

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

## Utilities

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
import { createBasePolicy, serializePolicy, withNonce } from '@varlabs/solidstep/utils/csp';

let cspPolicy = createBasePolicy();

...

cspPolicy = withNonce(cspPolicy, nonce);

...

event.response.headers.set('Content-Security-Policy', serializePolicy(cspPolicy));

...
```

### CSRF Protection
```tsx
import { csrf } from '@varlabs/solidstep/utils/csrf';

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

## Future Plans
- Support for dynamic site.webmanifest, robots.txt, sitemap.xml, manifest.json, and llms.txt
- Support loading and error pages for parallel routes
- Support deferring loaders
- Image/font optimizations
- Possible CSR/SPA, SSG, ISR, and PPR

## License

MIT

## Links

- [GitHub](https://github.com/HamzaKV/solidstep)
- [SolidJS Documentation](https://www.solidjs.com/)

## Special Mentions
- Inspired by [Remix](https://remix.run/), [Next.js](https://nextjs.org/), and [TanStack](https://tanstack.com/)
- Built with [Vite](https://vitejs.dev/), [SolidJS](https://www.solidjs.com/), [Vinxi](https://github.com/nksaraf/vinxi) and [Seroval](https://github.com/lxsmnsyc/seroval)
