# Data Validation

[← Back to docs index](./README.md)

SolidStep doesn't ship a validation library — you bring your own. Because loaders,
actions, and route handlers receive standard `Request` / params objects, any
validator works. This guide shows the recommended pattern using the
[Standard Schema](https://standardschema.dev/) spec, so the same code works with
**Zod**, **Valibot**, or **ArkType** interchangeably.

## A tiny Standard Schema helper

Standard Schema exposes a uniform `~standard.validate` method on every compatible
schema. A small helper turns a failed validation into a thrown error (which a
loader surfaces through `error.tsx`, or an action returns to the form):

```ts
// app/_lib/validate.ts
import type { StandardSchemaV1 } from '@standard-schema/spec';

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

export class ValidationError extends Error {
  constructor(public readonly issues: readonly StandardSchemaV1.Issue[]) {
    super(issues.map((i) => i.message).join(', '));
    this.name = 'ValidationError';
  }
}
```

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

Validate `FormData` inside the action and return field errors to the form via
[`useActionState`](./server-actions-and-forms.md) — no exception needed, so the
user sees inline messages:

```ts
import { z } from 'zod';

const SignUp = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

async function signUp(formData: FormData) {
  'use server';
  const parsed = await SignUp['~standard'].validate(
    Object.fromEntries(formData),
  );
  if (parsed.issues) {
    return { ok: false as const, errors: parsed.issues };
  }
  await createUser(parsed.value);
  return { ok: true as const };
}
```

## Notes

- **Validate at the trust boundary** — the loader/action/route handler — not in
  components. Treat `searchParams`, `params`, and `FormData` as untrusted input.
- **Coerce explicitly.** Query/form values are always strings; use your schema's
  coercion (`z.coerce.number()`, Valibot's `transform`, etc.).
- A thrown `ValidationError` in a **page** loader renders `error.tsx`; in a
  **layout/group** loader it yields the error sentinel (siblings still render).
  Returning errors from an action keeps the user on the page with inline feedback.
- Schema-validated actions as a first-class framework feature are
  [on the roadmap](./roadmap.md); this pattern works today.

## Related

- [Data Loading](./data-loading.md) — loaders, the `{ locals, signal }` context.
- [Server Actions & Forms](./server-actions-and-forms.md) — `useActionState` and field errors.
- [Security](./security.md) — the loader/action/route trust boundary.
