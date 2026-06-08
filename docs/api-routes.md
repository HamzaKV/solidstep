# API Routes

[← Back to docs index](./README.md)

## API Routes

Create REST endpoints by adding a `route.ts` file in a directory under `app/`. Export a function named after the HTTP method:

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

Each handler receives the `Request` and a context object containing `params` (dynamic route segments) and `searchParams`.

## Server Assets

Serve static files from the `server-assets/` directory:

```
my-app/
├── server-assets/
│   └── secret.txt
```

Access via `my-app/server-assets/secret.txt` URL:

```ts
const TEMPLATE_PATH = join(process.cwd(), 'server-assets', 'templates', 'template.ejs');
const template = await fs.promises.readFile(TEMPLATE_PATH, 'utf-8');
```

The `server-assets/` directory is copied into the production build — see [Deployment](./deployment.md).

## Related

- [Routing](./routing.md) — `route.ts` participates in the same file-based routing as pages.
- [Security](./security.md) — apply CORS, CSRF, and cookies in route handlers.
- [Utilities](./utilities.md#fetch-utilities) — type-safe fetch wrappers for calling APIs.
