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

## Hydration mismatch from `<Show>` as a top-level visibility toggle

**Symptom:** The dev overlay shows:

> Hydration Mismatch. Unable to find DOM nodes for hydration key: N

usually pointing at a `<button>` or `<div>` inside a dialog, dropdown, or collapsible sidebar section — and it gets more frequent the longer a dev session with many edits runs.

**Cause:** `<Show when={signal()}>` gating an **entire interactive subtree** (a dialog's open/closed content, a dropdown's open/closed menu, a sidebar's collapsed/expanded submenu) as a top-level, signal-driven switch. `Show`'s SSR-emitted comment-boundary markers can desync from what the client's hydration walk expects when it wraps a whole subtree like this — the mismatch compounds under `solid-refresh`'s dev-mode HMR patching across a long-lived browser session. A small `<Show>` nested inside an always-rendered container (guarding one conditional field, say) is fine; the problem is specifically using `<Show>` as the switch for the whole thing.

**Fix:** Render every branch unconditionally and toggle visibility with `classList` instead of removing/re-adding the subtree:

```tsx
// ❌ Breaks hydration - Show removes/re-adds the whole subtree
<Show when={open()}>
  <div class="dialog-content">...</div>
</Show>

// ✅ Always rendered, toggled via CSS - server and client agree on DOM shape
<div class="dialog-content" classList={{ hidden: !open() }}>...</div>
```

For content that's genuinely interactive-only and never needs to exist in the SSR payload at all (so it never goes through the hydration walk in the first place), use [`ClientOnly`](./client-only.md) instead:

```tsx
import { ClientOnly } from 'solidstep/client-only';

<ClientOnly fallback={null}>
  {() => <div class="dialog-content">...</div>}
</ClientOnly>
```

If you're still seeing occasional mismatches unrelated to this pattern after a very long dev session, see [Getting Started → Disabling client-side HMR](./getting-started.md#disabling-client-side-hmr).

## `ENOENT ... .config.json` on Netlify (or other serverless deploys)

**Symptom:** In production logs on a serverless preset (e.g. `netlify`):

> Error creating route manifest: Error: ENOENT: no such file or directory, open '/var/runtime/.config.json'

**Cause:** SolidStep locates the build-generated `.config.json` (see [Deployment → Build Output Notes](./deployment.md#build-output-notes)) relative to the running server's entry path. On serverless platforms, the handler is loaded inside an existing platform runtime process rather than started as `node .output/server/index.mjs`, so that entry path points at the *platform's* own runtime (`/var/runtime` on AWS Lambda, which Netlify Functions runs on) instead of the deployed function code. The server still starts and serves requests, but the resolved logger/cache/`loaderTimeout` config and ISR seeding from `prerender-manifest.json` silently don't load.

**Fix:** Fixed as of the version that added `resolveServerDir` fallback-to-`process.cwd()` behavior — update SolidStep. If you're still on an older version and can't upgrade immediately, this is otherwise harmless (routing/rendering keep working); it just means `defineConfig({ logger, cache, loaderTimeout })` and ISR seeding are inactive on that deploy.

## Related

- [Deployment](./deployment.md)
- [Caching](./caching.md)
- [Server Actions & Forms](./server-actions-and-forms.md)
- [Architecture](./architecture.md)
- [ClientOnly](./client-only.md)
