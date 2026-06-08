# Getting Started

[← Back to docs index](./README.md)

## Create a New Project

```bash
[npx | yarn dlx | pnpm dlx | bunx] @varlabs/create-solidstep@latest my-app
cd my-app
[npm | yarn | pnpm | bun] install
[npm | yarn | pnpm | bun] run dev
```

## Special Files

- `page.tsx` - Page component
- `layout.tsx` - Layout wrapper
- `loading.tsx` - Loading state (Streaming - optional)
- `error.tsx` - Error boundary (optional)
- `not-found.tsx` - 404 page (root only - optional)
- `route.ts` - API route handler
- `middleware.ts` - Request middleware
- `instrumentation.ts` - Server instrumentation hooks (optional)

**A route is defined by either the presence of a `page.tsx` or `route.ts` file in a directory.**

**Similar to NextJS, routes are not indexed if they have a '_' placed at the beginning of the name**

## Configuration

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

### Vite Configuration

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

__Exposing the dev server through a tunnel__

If you forward the dev server through a tunnel (ngrok, Cloudflare Tunnel, etc.) and hit:

> Blocked request. This host ("xxx.xxx.xxx.dev") is not allowed.

add the tunnel hostname to `vite.server.allowedHosts`:

```tsx
export default defineConfig({
  vite: {
    server: {
      allowedHosts: ['my-tunnel.example.dev'], // or `true` to allow any host
    },
  },
});
```

See also: [Troubleshooting](./troubleshooting.md#blocked-request-host).

## Project Structure

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

## Next Steps

- [Routing](./routing.md) — define pages, layouts, and dynamic routes.
- [Data Loading](./data-loading.md) — fetch data on the server.
- [Server Actions & Forms](./server-actions-and-forms.md) — type-safe mutations.
- [Deployment](./deployment.md) — ship to production.
