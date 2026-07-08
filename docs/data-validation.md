# Data Validation

[← Back to docs index](./README.md)

SolidStep doesn't ship a validation library — you bring your own. Because loaders,
actions, and route handlers receive standard `Request` / params objects, any
validator works. This guide shows the recommended pattern using the
[Standard Schema](https://standardschema.dev/) spec, so the same code works with
**Zod**, **Valibot**, or **ArkType** interchangeably.

## A tiny Standard Schema helper

Standard Schema exposes a uniform `~standard.validate` method on every compatible
schema. `solidstep/utils/action-schema` ships a small helper that turns a failed
validation into a thrown `ValidationError` (which a loader surfaces through
`error.tsx`, or an action's caller narrows via `useActionState().error()`):

```ts
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { ValidationError } from 'solidstep/utils/action-schema';

export async function validate<T extends StandardSchemaV1>(
  schema: T,
  input: unknown,
): Promise<StandardSchemaV1.InferOutput<T>> {
  const result = await schema['~standard'].validate(input);
  if (result.issues) {
    throw new ValidationError(result.issues);
  }
  return result.value;
}
```

For `FormData` specifically (the common case for server actions), use
`parseActionInput` — it does the coercion above for you (see
[Validating form data in a server action](#validating-form-data-in-a-server-action)
below).

## Validating search / path params in a loader

Coerce and validate `searchParams` (and route `params`) at the top of the loader.
An invalid request throws, and the route's `error.tsx` renders:

```ts
// app/products/page.tsx
import { z } from 'zod';
import { defineLoader } from 'solidstep/utils/loader';
import { validate } from '../_lib/validate';

const Query = z.object({
  page: z.coerce.number().int().min(1).default(1),
  q: z.string().trim().max(100).optional(),
});

export const loader = defineLoader(async (request) => {
  const url = new URL(request!.url);
  const { page, q } = await validate(Query, Object.fromEntries(url.searchParams));
  return { products: await searchProducts({ page, q }) };
});
```

> `searchParams` is also available pre-parsed on the page/loader props, but parsing
> the `URL` in the loader keeps validation close to where the data is used and works
> for repeated keys.

## Validating form data in a server action

`parseActionInput(schema, formData)` coerces the `FormData` (repeated keys become
arrays, `File` values stay `File`) and validates it, throwing `ValidationError`
on failure. Call it **inside your own `'use server'` action** — validation must
run there to be enforced; it can't be baked into a wrapping helper, because the
`'use server'` build transform extracts only the exact function it's attached
to, discarding any enclosing call. `useActionState().error()` then narrows to it
via `isValidationError`:

```ts
'use server';
import { z } from 'zod';
import { parseActionInput } from 'solidstep/utils/action-schema';

const SignUp = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export async function signUp(_prev: { ok?: true }, formData: FormData) {
  const input = await parseActionInput(SignUp, formData); // throws ValidationError
  await createUser(input);
  return { ok: true as const };
}
```

```tsx
import { useActionState } from 'solidstep/hooks/action-state';
import { isValidationError } from 'solidstep/utils/action-schema';
import { signUp } from './actions';

const [state, formAction, pending, error] = useActionState(signUp, {});

// error() is `Error | null`; narrow it to read `.issues`:
<Show when={error() && isValidationError(error())}>
  <For each={(error() as ReturnType<typeof error> & { issues: { message: string }[] }).issues}>
    {(issue) => <li>{issue.message}</li>}
  </For>
</Show>
```

`ValidationError` crosses the server-action wire via seroval, which doesn't
preserve custom `Error` subclasses — it reconstructs a plain `Error` with the
original's own-enumerable properties (`name`, `issues`) reassigned. So on the
client it's `.name === 'ValidationError'` but **not** `instanceof ValidationError`;
`isValidationError` checks `.name` for exactly this reason — always use it
instead of `instanceof` when narrowing on the client.

## Notes

- **Validate at the trust boundary** — the loader/action/route handler — not in
  components. Treat `searchParams`, `params`, and `FormData` as untrusted input.
- **Coerce explicitly.** Query/form values are always strings; use your schema's
  coercion (`z.coerce.number()`, Valibot's `transform`, etc.).
- A thrown `ValidationError` in a **page** loader renders `error.tsx`; in a
  **layout/group** loader it yields the error sentinel (siblings still render).
  In an action, it's caught by `useActionState` and surfaced via `error()`.

## Related

- [Data Loading](./data-loading.md) — loaders, the `{ locals, signal }` context.
- [Server Actions & Forms](./server-actions-and-forms.md) — `useActionState` and field errors.
- [Security](./security.md) — the loader/action/route trust boundary.
