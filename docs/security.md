# Security

[← Back to docs index](./README.md)

SolidStep ships built-in utilities for cookies, CORS, CSP, CSRF, redirects, error handling, and server-only code. Many of these are typically composed in [middleware](./middleware.md).

## Cookies

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

## CSP

```tsx
import { createBasePolicy, serializePolicy, withNonce } from 'solidstep/utils/csp';

let cspPolicy = createBasePolicy();

...

cspPolicy = withNonce(cspPolicy, nonce);

...

event.response.headers.set('Content-Security-Policy', serializePolicy(cspPolicy));

...
```

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
