# Middleware

[← Back to docs index](./README.md)

Intercept and modify requests. SolidStep's `defineMiddleware` composes an ordered array of middleware units into a single handler, so you can keep concerns (auth, CORS, CSRF, logging) in separate, reusable pieces:

```tsx
// app/middleware.ts
import { defineMiddleware, type Middleware } from 'solidstep/utils/middleware';

const logger: Middleware = {
  onRequest: (event) => {
    console.log('Incoming request:', event.path);
  },
};

const auth: Middleware = {
  onRequest: (event) => {
    if (!event.headers.get('authorization')) {
      // Return a Response to short-circuit — later middleware and the
      // route handler are skipped.
      return new Response('Unauthorized', { status: 401 });
    }
  },
};

export default defineMiddleware([logger, auth]);
```

- `onRequest` hooks run in array order and stop as soon as one returns a `Response` (or calls `event.respondWith(...)`).
- `onBeforeResponse` hooks always all run, in array order, and receive the resolved response so it can be inspected or mutated.

You can still use Vinxi's own single-object form from `vinxi/http` if you prefer:

```tsx
import { defineMiddleware } from 'vinxi/http';

export default defineMiddleware({
  onRequest: (event) => {
    console.log('Incoming request:', event.path);
  },
});
```

## Related

- [Security](./security.md) — common middleware concerns: CORS, CSRF, cookies, CSP.
- [Instrumentation](./instrumentation.md) — for observability hooks (a separate, server-wide API).
- [Architecture](./architecture.md) — where middleware sits in the request lifecycle.
