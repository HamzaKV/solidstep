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

## Streaming responses (SSE)

A handler can return a streaming `Response`. Rather than hand-rolling a
`ReadableStream`, use the helpers from `solidstep/utils/sse`:

- `sseResponse(generator, init?)` — Server-Sent Events. Yield strings (shorthand
  for `{ data }`) or `{ data, event?, id?, retry? }` objects; the correct
  `text/event-stream` headers are set for you.
- `streamResponse(generator, init?)` — arbitrary chunked text/bytes (yield
  `string` or `Uint8Array`); set your own `Content-Type` via `init`.

```ts
// app/events/route.ts
import { sseResponse } from 'solidstep/utils/sse';

export function GET() {
  return sseResponse(async function* () {
    for (let i = 0; i < 5; i++) {
      yield { event: 'tick', data: String(i) };
      await new Promise((r) => setTimeout(r, 1000));
    }
  });
}
```

The stream closes when the generator completes. (Note: a chunked stream with no
`Content-Length` isn't bounded by [`bodyLimit`](./security.md#rate-limiting--body-size).)

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
