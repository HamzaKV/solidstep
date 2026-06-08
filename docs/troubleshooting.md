# Troubleshooting

[← Back to docs index](./README.md)

Practical fixes for common issues. If something here doesn't resolve your problem, please [open an issue](https://github.com/HamzaKV/solidstep/issues).

## Blocked request host

**Symptom:** When forwarding the dev server through a tunnel (ngrok, Cloudflare Tunnel, etc.), the browser shows:

> Blocked request. This host ("xxx.xxx.xxx.dev") is not allowed.

**Fix:** Add the tunnel hostname to `vite.server.allowedHosts` in `app.config.ts`:

```tsx
export default defineConfig({
  vite: {
    server: {
      allowedHosts: ['my-tunnel.example.dev'], // or `true` to allow any host
    },
  },
});
```

See [Getting Started → Vite Configuration](./getting-started.md#vite-configuration).

## Node < 20, or `node:sqlite` / better-sqlite3 errors

**Symptom:** The dev or production server fails to start with an error referencing `node:sqlite`, an `ERR_UNKNOWN_BUILTIN_MODULE`, or a database connector.

**Cause:** SolidStep requires **Node >= 20**. Additionally, Nitro's default Node database connector bundles an (unused) `import 'node:sqlite'` — a builtin that only exists in Node 22.5+ — so on Node 20/21 the server can crash at startup even with no database.

**Fix:**

1. Upgrade to Node >= 20 (ideally 22.5+ to avoid the `node:sqlite` issue entirely).
2. If you must stay on Node 20/21, alias the builtin to an empty stub (the `create-solidstep` template ships `sqlite-stub.mjs` for this). See [Deployment → Node Version](./deployment.md#node-version) for the full `app.config.ts` snippet.

## Server action returning unexpected types

**Symptom:** A server action's return value arrives on the client as `undefined`, a stripped-down object, or throws during deserialization.

**Cause:** Server-action arguments and return values cross the network via [seroval](https://github.com/lxsmnsyc/seroval) (see [Architecture → Server-Action Serialization](./architecture.md#6-server-action-serialization)). Only types supported by the configured plugin set serialize cleanly — supported types include `FormData`, `Headers`, `Request`/`Response`, `URL`, `URLSearchParams`, and `ReadableStream`, plus standard JSON-like values, `Date`, `Map`, `Set`, etc. Class instances, functions, and other non-serializable values do not round-trip.

**Fix:** Return plain, serializable data (objects, arrays, primitives) or one of the supported web types. Convert class instances to plain objects before returning. If you're testing actions and need to mock a response, stringify JSON return values and set `Content-Type: application/json`; for complex return types, serialize with seroval.

## Cache not invalidating

**Symptom:** After a mutation, a page still shows stale data even though the underlying data changed.

**Cause:** Pages with a positive `options.cache.ttl` are cached server-side for that duration (see [Caching](./caching.md)). The cache is not cleared automatically when you mutate data.

**Fix:** Invalidate the affected path from within a **server action**:

- Use `revalidatePath('/some-route')` to clear the cache *and* revalidate the frontend DOM (single-flight mutation), or
- Use `invalidateCache('/some-route')` to only drop the cached entry.

```tsx
import { revalidatePath } from 'solidstep/utils/cache';

const action = async () => {
  'use server';
  // ...mutate data...
  await revalidatePath('/some-route');
  return { success: true };
};
```

## Related

- [Deployment](./deployment.md)
- [Caching](./caching.md)
- [Server Actions & Forms](./server-actions-and-forms.md)
- [Architecture](./architecture.md)
