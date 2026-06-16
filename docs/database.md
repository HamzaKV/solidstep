# Database & ORM Integration

[← Back to docs index](./README.md)

SolidStep is unopinionated about data access — any Node-compatible database client
or ORM works. The two things to get right are **where the connection lives** (one
pooled client per server process, initialized once) and **keeping it off the
client bundle**.

## Keep the client server-only

Put your database client behind [`server-only`](./security.md#server-only-code) so
it can never be imported into the browser bundle (which would leak your connection
string):

```ts
// app/_lib/db.ts
import 'solidstep/utils/server-only';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool);
```

A module is evaluated once per process, so `pool` is a single shared pool —
exactly what you want. Import `db` from loaders, actions, and route handlers.

## Initialize/verify at startup with instrumentation

Use the [instrumentation](./instrumentation.md) `register()` hook to run startup
work (connect, run a ping, warm the pool) before the first request, and a shutdown
hook to drain it:

```ts
// app/instrumentation.ts
import { defineInstrumentation } from 'solidstep/utils/instrumentation';
import { pool } from './_lib/db';

export default defineInstrumentation({
  async register() {
    await pool.query('select 1'); // fail fast if the DB is unreachable
  },
  async onShutdown() {
    await pool.end();
  },
});
```

> `register()` completes before any request is handled, and a throw there prevents
> the server from starting — useful for failing fast on a bad connection.

## Using it in loaders and actions

```ts
// app/users/page.tsx
import { defineLoader } from 'solidstep/utils/loader';
import { db } from '../_lib/db';
import { users } from '../_lib/schema';

export const loader = defineLoader(async (_request, { signal }) => {
  // Forward the abort signal so a client disconnect / loader timeout cancels
  // the query (driver permitting).
  return { users: await db.select().from(users) };
});
```

```ts
async function createUser(formData: FormData) {
  'use server';
  await db.insert(users).values({ email: String(formData.get('email')) });
  revalidatePath('/users');
}
```

## Prisma

The same shape works with Prisma — one `PrismaClient` per process, behind
`server-only`:

```ts
// app/_lib/db.ts
import 'solidstep/utils/server-only';
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();
```

```ts
// app/instrumentation.ts
import { prisma } from './_lib/db';

export default defineInstrumentation({
  async register() {
    await prisma.$connect();
  },
  async onShutdown() {
    await prisma.$disconnect();
  },
});
```

## Tips

- **One client per process.** Don't create a client per request — module-level
  singletons reuse the connection pool. On serverless/edge presets, follow your
  provider's pooling guidance (e.g. a serverless driver / external pooler).
- **Secrets stay unprefixed.** `DATABASE_URL` must not be `VITE_`-prefixed or it
  would be inlined into the client bundle — see [Assets & Env](./assets-and-env.md).
- **Per-request context.** To attach a request-scoped handle (e.g. a transaction
  or tenant-scoped client) set it on `event.locals` in
  [middleware](./middleware.md); loaders receive it via `context.locals`.
- **Cache expensive reads** with [loader caching](./caching.md) (`ttl`/`swr`/`tags`)
  and invalidate with `revalidatePath` / `invalidateTag` after writes.

## Related

- [Instrumentation](./instrumentation.md) — `register` / `onShutdown` lifecycle hooks.
- [Security](./security.md#server-only-code) — `server-only` boundary for secrets.
- [Data Loading](./data-loading.md) — loaders, `{ locals, signal }` context, caching.
