# Server Actions & Forms

[← Back to docs index](./README.md)

## Server Actions

Create type-safe server functions:

```tsx
'use server';

export const createPost = async (data: { title: string }) => {
  await db.posts.create(data);
  return { success: true };
};
```

Call from client:

```tsx
import { createPost } from './actions';

function CreatePostForm() {
  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    await createPost({ title: 'My Post' });
  };

  return <form onSubmit={handleSubmit}>...</form>;
}
```

## Form Actions

Use the `<Form>` component to submit forms via server actions — similar to Next.js form handling:

```tsx
// app/invoices/actions.ts
'use server';

export async function createInvoice(formData: FormData) {
  const rawFormData = {
    customerId: formData.get('customerId'),
    amount: formData.get('amount'),
    status: formData.get('status'),
  };
  // mutate data, revalidate cache
}
```

```tsx
// app/invoices/page.tsx
import { Form } from 'solidstep/form';
import { createInvoice } from './actions';

export default function Page() {
  return (
    <Form action={createInvoice}>
      <input name="customerId" />
      <input name="amount" type="number" />
      <select name="status">
        <option value="pending">Pending</option>
        <option value="paid">Paid</option>
      </select>
      <button type="submit">Create Invoice</button>
    </Form>
  );
}
```

**Passing additional arguments with `bind`:**

```tsx
import { Form } from 'solidstep/form';
import { updateUser } from './actions';

export function UserProfile(props: { userId: string }) {
  const updateUserWithId = updateUser.bind(null, props.userId);

  return (
    <Form action={updateUserWithId}>
      <input type="text" name="name" />
      <button type="submit">Update User Name</button>
    </Form>
  );
}
```

**Form validation with `useActionState`:**

```tsx
import { useActionState } from 'solidstep/hooks/action-state';
import { Form } from 'solidstep/form';
import { signup } from './actions';

export function SignupForm() {
  const [state, formAction, pending, error] = useActionState(signup, {
    errors: {} as Record<string, string[]>,
    message: '',
  });

  return (
    <Form action={formAction}>
      <label for="email">Email</label>
      <input type="email" id="email" name="email" required />
      {state().errors.email && <span>{state().errors.email[0]}</span>}
      <p aria-live="polite">{state().message}</p>
      {error() && <p role="alert" style="color:red">{error()!.message}</p>}
      <button disabled={pending()}>
        {pending() ? 'Signing up...' : 'Sign up'}
      </button>
    </Form>
  );
}
```

**Pending state with `useFormStatus`:**

```tsx
import { useFormStatus } from 'solidstep/hooks/form-status';

export function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button disabled={pending()} type="submit">
      {pending() ? 'Submitting...' : 'Submit'}
    </button>
  );
}
```

**Handling errors outside `useActionState`:** a plain `action` (not wrapped by
`useActionState`) has no `error()` accessor of its own — `<Form>` only logs a
rejection via `console.error`. Pass `onError` to handle it yourself:

```tsx
<Form action={createInvoice} onError={(error) => toast.error(String(error))}>
  ...
</Form>
```

> **Good to know:**
> - `<Form>` supports progressive enhancement — when JS is disabled, forms submit natively to the server action endpoint.
> - `useActionState` returns SolidJS accessors: call `state()`, `pending()`, and `error()` to read values. `error()` is `null` until the action throws, and resets to `null` on the next submission. Its `formAction` also returns a `Promise<void>` that resolves once the action settles (whether it succeeds or throws) — await it if you need to know when the submission finished.
> - `useFormStatus` must be used in a component nested inside `<Form>`.

## Related

- [Caching](./caching.md) — use `revalidatePath` in a server action to refresh cached pages.
- [Security](./security.md) — set cookies and handle CSRF for mutations.
- [Architecture](./architecture.md) — how action arguments and return values are serialized.
- [Troubleshooting](./troubleshooting.md#server-action-returning-unexpected-types) — server action return type gotchas.
