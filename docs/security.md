# Security

[← Back to docs index](./README.md)

SolidStep ships built-in utilities for cookies, CORS, CSP, CSRF, redirects, error handling, and server-only code. Many of these are typically composed in [middleware](./middleware.md).

## Cookies

For session/auth cookies, prefer `setSecureCookie`, which applies protective
defaults (`httpOnly`, `sameSite: 'lax'`, `path: '/'`, and `secure` in production)
that you'd otherwise have to remember on every call. Any field can still be
overridden via the options argument (which wins over the defaults):

```tsx
import { setSecureCookie } from 'solidstep/utils/cookies';

// httpOnly + secure (in prod) + sameSite=lax applied automatically.
await setSecureCookie('session', token, { maxAge: 3600 });
// Override a default when you need to:
await setSecureCookie('session', token, { sameSite: 'strict' });
```

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

## CORS

```tsx
import { cors } from 'solidstep/utils/cors';

const trustedOrigins = ['https://example.com', 'https://another-example.com'];

const corsMiddleware = cors(trustedOrigins);

...

const corsHeaders = corsMiddleware(origin, event.node.req.method === 'OPTIONS');

...
```

To send cookies / `Authorization` on cross-origin requests, enable credentials
via the fourth argument — `Access-Control-Allow-Credentials: true` is then added
for trusted (non-wildcard) origins:

```tsx
const corsMiddleware = cors(trustedOrigins, undefined, undefined, {
    allowCredentials: true,
});
```

## CSP

```tsx
import { createNoncePolicy, serializePolicy } from 'solidstep/utils/csp';

// Secure-by-default: strict baseline + the per-request nonce on script/style-src,
// with no 'unsafe-inline' / 'unsafe-eval'.
const cspPolicy = createNoncePolicy(nonce);

...

event.response.headers.set('Content-Security-Policy', serializePolicy(cspPolicy));

...
```

> **Pick the right preset.** `createNoncePolicy(nonce)` is the recommended
> production starting point. `createStrictPolicy()` gives the same locked-down
> baseline without inline script/style support, and you can layer the helpers
> (`withNonce`, `withCDN`, `withGoogleFonts`, …) onto it. `createBasePolicy()` is
> a **permissive dev convenience** — it includes `'unsafe-inline'` and
> `'unsafe-eval'`; strip them with `withProductionSources(policy)` before shipping
> if you use it.

The CSP nonce is exposed to pages, layouts, and [metadata](./metadata.md) functions via `cspNonce`.

> **Strict CSP requires the nonce.** SolidStep emits several inline scripts per
> response (the hydration entry, the client manifest, and the loader-data
> payload). Each one is automatically stamped with the `cspNonce` set on the
> request (`event.locals.cspNonce`). If you serve a strict `script-src` policy
> **without** establishing a nonce in middleware, those inline scripts are
> blocked and the page will not hydrate. Always generate a nonce per request and
> add it to the policy with `withNonce(...)` (as above) when locking down
> `script-src`.
>
> Note: the client build manifest is currently exposed on `window.manifest` via
> an inline script. It contains only public asset metadata (no secrets), but
> moving it out of an inline global is a planned hardening.

### Output escaping

Loader data, route params, and metadata are **escaped** before being written
into the HTML response: attribute values and text are HTML-escaped, and any data
embedded inside an inline `<script>` (loader data, params) is escaped so it
cannot break out of the script (e.g. a value containing `</script>`). Loader
data is serialized with [seroval](https://github.com/lxsmnsyc/seroval) — the
same transport used by server actions — so `Date`, `Map`, `Set`, and `BigInt`
round-trip to the client intact. You do not need to escape values you return
from a loader or `generateMeta`.

## CSRF Protection

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

## Server function origin check (built-in, on by default)

Every request to a server function (`/_server`) is checked before the action
runs: if `Sec-Fetch-Site`/`Origin` shows the request came from another,
untrusted origin, it's rejected with a 403. A request with neither header
(non-browser clients — curl, mobile apps, server-to-server calls) is
unaffected, since a browser making a cross-origin request always sends at
least one of them.

```ts
// app.config.ts
export default defineConfig({
    security: {
        serverActions: {
            trustedOrigins: ['partner.example.com'],
            // originCheck: false, // disable entirely
        },
    },
});
```

Add a host to `trustedOrigins` if you have a legitimate cross-origin caller
(a mobile app's webview, another site embedding a form that posts to your
server functions). This is separate from the `csrf`/`cors` middleware
helpers above, which you compose yourself for your own API routes — this
check applies automatically to the server-action transport.

## Redirects

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

When the destination comes from **untrusted input** (a `?next=` param, a form
field), use `safeRedirect` instead of `redirect` to avoid open-redirect abuse. It
redirects only to same-site relative paths and to absolute URLs whose host you
explicitly allowlist; anything else (off-site URLs, `javascript:`/`data:`,
protocol-relative `//evil.com`) falls back to `'/'` (or your `fallback`):

```tsx
import { safeRedirect, isSafeRedirectTarget } from 'solidstep/utils/redirect';

safeRedirect(nextParam);                                  // → '/' if unsafe
safeRedirect(nextParam, { fallback: '/login' });
safeRedirect(nextParam, { allowedHosts: ['auth.example.com'] });

// Or validate without redirecting:
if (isSafeRedirectTarget(nextParam)) { /* ... */ }
```

## Error Handling

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

## Rate limiting & body size

Two composable [middleware](./middleware.md) guard against abusive traffic. Both
short-circuit with an error `Response` before the route runs.

```tsx
// app/middleware.ts
import { defineMiddleware } from 'solidstep/utils/middleware';
import { rateLimit } from 'solidstep/utils/rate-limit';
import { bodyLimit } from 'solidstep/utils/body-limit';

export default defineMiddleware([
  bodyLimit({ maxBytes: 1_000_000 }),        // 413 when Content-Length is too big
  rateLimit({ windowMs: 60_000, max: 100 }), // 429 (with Retry-After) past the limit
]);
```

- `rateLimit` counts requests per key in a fixed window on the active
  [`CacheStore`](./caching.md#pluggable-cache-stores), so it works across
  instances when backed by an external store (e.g. Redis). The key defaults to
  the client IP (`x-forwarded-for` first hop, else the socket address); pass
  `key: (event) => ...` to bucket by user id, API key, or route instead.
- `bodyLimit` rejects based on the declared `Content-Length`. A chunked request
  with no `Content-Length` is not caught here — bound those at your
  runtime/proxy. Treat it as a first line of defence, not a hard cap.

> **`X-Forwarded-For` is a trust boundary you must configure.** The default
> key trusts the request's `x-forwarded-for` header verbatim (its first,
> left-most hop). A client that talks to your app directly (no proxy in
> front) can set this header to anything, including someone else's IP —
> trivially bypassing the limiter or framing another client for a 429. This
> is only safe once you sit behind a reverse proxy/load balancer that
> **strips or overwrites** any client-supplied `X-Forwarded-For` before
> appending the real hop (this is deployment-specific and out of SolidStep's
> control). If you can't guarantee that, pass your own `key` derived from a
> value you actually trust (a session id, an API key, `event.node.req.socket.remoteAddress`).

## Production error messages

When a page loader throws, the framework does **not** leak the raw error message
to the browser in production. For a soft-navigation failure it logs the message
server-side under a generated `errorId` (via the [logger](./utilities.md#logging))
and sends a generic message plus that id to the client, so you can correlate a
user report to a server log without exposing internal details (SQL text, file
paths, secrets). In development the full message is sent through for debugging.

## Server-Only Code

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

## Related

- [Middleware](./middleware.md) — compose CORS/CSRF/auth as reusable units.
- [Assets & Environment](./assets-and-env.md#environment-variables) — keep secrets out of `VITE_`-prefixed vars.
- [Server Actions & Forms](./server-actions-and-forms.md) — secure mutations.
