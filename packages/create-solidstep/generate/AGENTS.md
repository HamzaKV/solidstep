# AGENTS.md — Working on this SolidStep app

This is a **SolidStep** app: a full-stack SSR framework for **SolidJS**, built on Vinxi/Nitro.
Conventions resemble Next.js App Router, but the component model is SolidJS — **do not write React idioms**:

- Components run **once** (no re-render). Reactivity comes from signals/accessors.
- **Never destructure props** — it breaks reactivity. Use `props.x` inline.
- Reactive values are functions: call them (`state()`, `pending()`, `props.children()`).
- Use `<Show>` / `<For>` from `solid-js` instead of `&&` / `.map()` for reactive branches and lists.

Full docs: <https://github.com/HamzaKV/solidstep/blob/main/docs/README.md>
(machine-readable index: <https://github.com/HamzaKV/solidstep/blob/main/docs/llms.txt>)

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server (vinxi dev) |
| `npm run build` | Production build (vinxi build) |
| `npm run start` | Serve the production build (vinxi start) |

`solidstep-env.d.ts` is **generated** during dev/build and gitignored — never edit or commit it.
Typed routes (`Href`, `PageProps<...>`) only exist after dev or build has run at least once.

## Routing and special files

File-based routing under `app/`. A URL route exists iff its directory contains `page.tsx` or `route.ts`.

| File | Role |
|---|---|
| `page.tsx` | Route UI. Default-export a component. May also export `loader`, `generateMeta`, `options`, `generateStaticParams`. |
| `layout.tsx` | Shared wrapper. **`props.children` is a function** — render `{props.children()}`. Root layout renders `<body>`. |
| `loading.tsx` | Fallback while loaders stream/defer. |
| `error.tsx` | Error boundary for the segment. Receives an `error` prop. |
| `not-found.tsx` | 404 page (app root only). |
| `route.ts` | API endpoint. Export `GET` / `POST` / `PUT` / `PATCH` / `DELETE` as `(request, { params, searchParams }) => Response`. |
| `actions.ts` | Server actions (convention). Must start with `'use server';`. |
| `app/middleware.ts` | Request/response interceptors (app root only). |
| `app/instrumentation.ts` | Observability hooks (app root only). |
| `app/robots.ts`, `sitemap.ts`, `manifest.ts`, `llms.ts` | Default-export functions serving `/robots.txt`, `/sitemap.xml`, `/manifest.webmanifest`, `/llms.txt`. |

Directory conventions:

- `[slug]` — dynamic segment → `props.routeParams.slug` (already percent-decoded).
- `[...path]` — catch-all; `[[...path]]` — optional catch-all.
- `(group)` — organizational only, stripped from the URL.
- `@name` — parallel route slot, rendered by the layout via `props.slots.name()`; may have its own `loading.tsx`/`error.tsx`.
- `_prefixed` directories are private — never routed.

## Data loading

Loaders run **on the server only**; their body and imports never reach the browser bundle.

```tsx
import { defineLoader, type LoaderDataFromFunction } from 'solidstep/utils/loader';

export const loader = defineLoader(async (request, { locals, signal }) => {
    return { user: await getUser(request) };
});

type LoaderData = LoaderDataFromFunction<typeof loader>;

export default function Page(props: { loaderData: LoaderData }) {
    return <h1>{props.loaderData.user.name}</h1>;
}
```

- Page and layout loaders run concurrently.
- Non-JSON values survive serialization to the client (Date, Map, Set, BigInt — via seroval).
- Second argument options: `{ type: 'defer' | 'sequential', timeout, cache: { ttl, key, swr, tags } }`
  (`ttl`/`swr` in milliseconds; `timeout` in ms, rejects with `LoaderTimeoutError`).
- **`type: 'defer'` changes the prop shape**: `props.loaderData` becomes an accessor
  `() => LoaderData | undefined` that suspends — `loading.tsx` is the fallback. Deferred loaders cannot redirect.
- Middleware can pass per-request data via `locals`; augment its type with
  `declare module 'solidstep/utils/loader' { interface Locals { ... } }`.

## Server actions and forms

`actions.ts` starts with `'use server';`. Actions have the signature `(prevState, formData) => Promise<newState>`.

```tsx
import { useActionState } from 'solidstep/hooks/action-state';
import { Form } from 'solidstep/form';
import { sendMessage } from './actions';

const [state, formAction, pending, error] = useActionState(sendMessage, { sent: false });

<Form action={formAction}>
    <input name='name' required />
    <button type='submit' disabled={pending()}>Send</button>
</Form>
```

- `useActionState` returns **four accessors**: `[state, formAction, pending, error]`.
- `<Form>` (from `solidstep/form`) is progressively enhanced — works without JS; supports `onError`.
- `useFormStatus()` (from `solidstep/hooks/form-status`) reads pending state — **only works inside `<Form>`**.
- Pass extra arguments with `.bind(null, extra)`.
- Calling `revalidatePath('/route')` inside an action refreshes that route on the client after the action.
- Validate inputs with `parseActionInput(schema, formData)` + `isValidationError` from
  `solidstep/utils/action-schema` (accepts any Standard Schema: Zod, Valibot, ArkType).

## Navigation and typed routes

```tsx
import { Link } from 'solidstep/link';
<Link href='/about' prefetch='hover'>About</Link>
```

- `Link` props: `href` (type-checked), `prefetch: 'hover' (default) | 'viewport' | true | false`,
  `replace`, `scroll`, `viewTransition`.
- From `solidstep/router`: `useNavigate()`, `usePathname()`, `useSearchParams()`,
  `useRouter()` (`{ route, navigate, refresh, pending }`), `navigationPending`, `prefetchRoute`,
  and types `Href`, `RouteId`, `RouteParams`, `PageProps`.
- Typed page props for dynamic routes: `export default function Post(props: PageProps<'/blog/[slug]'>)`
  → `props.routeParams.slug` is typed.

## Rendering strategies and caching

Per-route options are exported from `page.tsx`:

```ts
import { options as defineOptions } from 'solidstep/utils/options';

export const options = defineOptions({
    render: 'isr',      // 'dynamic' (default) | 'static' | 'isr' | 'ppr'
    revalidate: 60,     // seconds, ISR only
    cache: { ttl: 60_000, swr: 30_000, tags: ['posts'] }, // ms
});
```

- Dynamic routes using `static`/`isr`/`ppr` must export `generateStaticParams`
  (type `GenerateStaticParams` from `solidstep/utils/prerender`).
- `ppr` prerenders a static shell; mark the dynamic holes with deferred loaders (`type: 'defer'`).
- Invalidation from `solidstep/utils/cache`: `invalidateCache(key)`, `invalidateTag(tag)`,
  `revalidatePath(path)`, `setCacheStore(store)` — **all async, always `await` them**.
- Pluggable stores: `MemoryCacheStore` (default), `FilesystemCacheStore` from `solidstep/utils/cache-store`.

## Metadata

Any `page.tsx`/`layout.tsx` may export `generateMeta` returning head-element descriptors:

```ts
export const generateMeta = () => ({
    title: { type: 'title', attributes: {}, content: 'Home · MyApp' },
    description: {
        type: 'meta',
        attributes: { name: 'description', content: 'My app.' },
    },
});
```

For typed/async versions wrap with `meta()` from `solidstep/utils/meta`
(receives `{ req, cspNonce }`). Body helpers for metadata files:
`robots()` / `sitemap()` from `solidstep/utils/metadata`.

## Configuration (`app.config.ts`)

```ts
import { defineConfig } from 'solidstep';
export default defineConfig({ server: { preset: 'node-server' } });
```

- `server.preset` — Nitro deploy target (`node-server`, `vercel`, `cloudflare`, `netlify`, ...).
  This template also sets a `node:sqlite` stub alias for Node 20/21 compat — **do not remove it**.
- Other keys: `plugins: [{ type: 'client' | 'server' | 'both', plugin }]`, `vite` (overrides),
  `logger`, `cache`, `loaderTimeout` (global loader timeout in ms), `security`.
- Path aliases must be declared in **both** `tsconfig.json` `paths` and `vite.resolve.alias`.

## Middleware and security

`app/middleware.ts` default-exports `defineMiddleware([...])` (from `solidstep/utils/middleware`);
each entry is `{ onRequest?, onResponse? }` and can short-circuit by returning a `Response`.

The scaffolded middleware already wires **bodyLimit, rateLimit, CORS, CSRF, and a CSP nonce**.
To allow cross-origin callers, edit `trustedOrigins` / set the `TRUSTED_ORIGINS` env var —
**do not delete the security middleware**.

- Cookies: `getCookie` / `setCookie` / `setSecureCookie` / `deleteCookie` from `solidstep/utils/cookies`.
- Redirects: `redirect(url)` from `solidstep/utils/redirect` — works in loaders, actions, and on the client.
- Keep secrets server-side: `import 'solidstep/utils/server-only';` at the top of a module makes any
  client import of it throw.

## Import cheat sheet

| Import path | Exports |
|---|---|
| `solidstep` | `defineConfig` |
| `solidstep/form` | `Form` |
| `solidstep/link` | `Link` |
| `solidstep/router` | `useNavigate`, `usePathname`, `useSearchParams`, `useRouter`, `navigationPending`, `prefetchRoute`, `Href`, `RouteId`, `RouteParams`, `PageProps` |
| `solidstep/hooks/action-state` | `useActionState` |
| `solidstep/hooks/form-status` | `useFormStatus` |
| `solidstep/utils/loader` | `defineLoader`, `LoaderDataFromFunction`, `Locals` |
| `solidstep/utils/action-schema` | `parseActionInput`, `ValidationError`, `isValidationError` |
| `solidstep/utils/options` | `options` |
| `solidstep/utils/prerender` | `GenerateStaticParams` |
| `solidstep/utils/cache` | `invalidateCache`, `invalidateTag`, `revalidatePath`, `setCacheStore` |
| `solidstep/utils/cache-store` | `MemoryCacheStore`, `FilesystemCacheStore`, `CacheStore` |
| `solidstep/utils/meta` | `meta` |
| `solidstep/utils/metadata` | `robots`, `sitemap` |
| `solidstep/utils/middleware` | `defineMiddleware`, `Middleware` |
| `solidstep/utils/instrumentation` | `defineInstrumentation` |
| `solidstep/utils/redirect` | `redirect`, `safeRedirect` |
| `solidstep/utils/cookies` | `getCookie`, `setCookie`, `setSecureCookie`, `deleteCookie` |
| `solidstep/utils/cors` | `cors` |
| `solidstep/utils/csrf` | `csrf` |
| `solidstep/utils/csp` | `createBasePolicy`, `withNonce`, `serializePolicy` |
| `solidstep/utils/body-limit` | `bodyLimit` |
| `solidstep/utils/rate-limit` | `rateLimit` |
| `solidstep/utils/server-only` | (side-effect: throws on client import) |
| `solidstep/utils/client-only` | (side-effect: marks module client-only) |
| `solidstep/utils/logger` | `logger` (Pino instance) |
| `solidstep/utils/fetch.client` / `fetch.server` | typed `fetch` wrappers with timeout |
| `solidstep/utils/sse` | `sseResponse`, `streamResponse` |
| `solidstep/utils/error-handler` | `createErrorFactory` |
| `solidstep/utils/loader-timeout` | `LoaderTimeoutError` |

## Common pitfalls

1. **Never destructure props** (`function Page({ loaderData })` breaks reactivity) — use `props.loaderData`.
2. Accessors are functions — `state().sent`, `pending()`, `props.children()`, not `state.sent`.
3. Components run once; put reactive logic in JSX expressions or `createEffect`, not in the component body.
4. A deferred loader's `loaderData` prop is an **accessor**, not an object — and deferred loaders cannot redirect.
5. Cache utilities (`invalidateCache`, `invalidateTag`, ...) are async — always `await`.
6. `useFormStatus()` only works inside a `<Form>` subtree.
7. Route params arrive percent-decoded — do not decode again.
8. A static `public/robots.txt` shadows `app/robots.ts` (same for other metadata files).
9. In dev, `render: 'static'`/`'isr'` pages render dynamically — verify prerendering with `npm run build`.
10. Path alias added to `tsconfig.json` but not `vite.resolve.alias` (or vice versa) fails at build.
