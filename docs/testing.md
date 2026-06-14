# Testing

[← Back to docs index](./README.md)

SolidStep is tested at two levels:

- **Unit tests** (Vitest) for the framework's pure logic, hooks, and components — they live in `packages/solidstep/tests/` as `*.test.ts` / `*.test.tsx`.
- **End-to-end tests** (Playwright) that drive the built `examples/kitchen-sink` app in a real browser — they live in `examples/kitchen-sink/tests/` as `*.spec.ts`.

The same patterns apply to your own app, so this guide doubles as a recipe book.

## Unit testing with Vitest

The framework package uses [Vitest](https://vitest.dev) with the Solid plugin. From `packages/solidstep/`:

```bash
pnpm test          # vitest run  — single pass, exits when done
pnpm test:watch    # vitest      — watch mode
```

The configuration lives in `packages/solidstep/vitest.config.ts`. The points worth knowing when writing tests:

- The default `environment` is **`node`**, which keeps pure-logic specs fast.
- Specs that need a DOM (component rendering, anything touching `window`/`document`) opt into jsdom with a docblock pragma — see below.
- The Solid plugin (`vite-plugin-solid`) compiles JSX and resolves `solid-js` to its client/dev build, and `solid-js` / `@solidjs/testing-library` are inlined (not externalized) so reactivity and `render()` work under test.
- Coverage uses the `v8` provider over `utils/**/*.ts` with **100% line / function / branch / statement thresholds**. Entry points and browser-coupled runtime modules (the client router, `server-action.*`, `router.ts`, etc.) are excluded from coverage because they are exercised by the e2e suite instead.

### The `// @vitest-environment jsdom` pragma

Because the global environment is `node`, a spec that renders components or uses DOM APIs must declare jsdom as the **first line** of the file:

```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
```

Pure-logic specs (loaders, cache, serialization framing, middleware) omit the pragma and run on `node`.

## Testing loaders

`defineLoader` only returns a loader on the server — on the client it returns `null` so the loader body is never shipped to the browser. It gates on `isServer` from `solid-js/web`, so loader unit tests mock that module and re-import `defineLoader` per case. This pattern is taken from `packages/solidstep/tests/loader.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('defineLoader (server)', () => {
    beforeEach(() => vi.resetModules());

    it('wraps the result as { data, type } and passes the Request through', async () => {
        vi.doMock('solid-js/web', () => ({ isServer: true }));
        const { defineLoader } = await import('../utils/loader');

        const spy = vi.fn(async (_req?: Request) => ({ hello: 'world' }));
        const def = defineLoader(spy);

        const request = new Request('https://example.com/');
        const resolved = await def!.loader(request);

        expect(spy).toHaveBeenCalledWith(request);
        expect(resolved).toEqual({ data: { hello: 'world' }, type: 'sequential' });
    });

    it('returns null on the client', async () => {
        vi.doMock('solid-js/web', () => ({ isServer: false }));
        const { defineLoader } = await import('../utils/loader');
        expect(defineLoader(async () => ({}))).toBeNull();
    });
});
```

The `type` defaults to `'sequential'`; passing `{ type: 'defer' }` produces a deferred loader (`{ data, type: 'defer' }`).

### Mocking `vinxi/http`

Loaders, caching, and middleware reach into the H3 request context via `vinxi/http`. In unit tests that module is mocked so the code under test runs without a live server. Mock only the functions you need. From `packages/solidstep/tests/cache.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('vinxi/http', () => ({
    getEvent: vi.fn(),
    setResponseHeader: vi.fn(),
}));

import { setCache, getCache, clearAllCache } from '../utils/cache';

beforeEach(async () => { await clearAllCache(); });
afterEach(async () => { await clearAllCache(); });

it('stores and retrieves a value', async () => {
    await setCache('key1', { data: 42 });
    expect(await getCache('key1')).toEqual({ data: 42 });
});
```

`middleware.test.ts` mocks `vinxi/http`'s `defineMiddleware` to simply return its options object, then composes a fake H3 event (with a `respondWith` spy and a `handled` getter) to assert short-circuiting and ordering behavior.

## Testing server actions and action state

`useActionState` is a reactive hook, so its tests run inside a Solid reactive root and assert on the returned accessors. The helper below (from `packages/solidstep/tests/action-state.test.ts`) wraps `createRoot` and disposes once the work settles:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'solid-js';
import { useActionState } from '../utils/hooks/action-state';

function withRoot<T>(fn: (dispose: () => void) => Promise<T> | T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        createRoot((dispose) => {
            Promise.resolve(fn(dispose)).then(
                (value) => { dispose(); resolve(value); },
                (err) => { dispose(); reject(err); },
            );
        });
    });
}

it('runs the action, toggles pending, and updates state', async () => {
    await withRoot(async () => {
        const action = vi.fn(async (prev: { n: number }) => ({ n: prev.n + 1 }));
        const [state, formAction, pending, error] = useActionState(action, { n: 0 });

        const data = new FormData();
        formAction(data);
        expect(pending()).toBe(true);            // flips synchronously

        await vi.waitFor(() => expect(pending()).toBe(false));
        expect(action).toHaveBeenCalledWith({ n: 0 }, data);
        expect(state()).toEqual({ n: 1 });
        expect(error()).toBeNull();
    });
}
```

Use `vi.waitFor(...)` to await the asynchronous settle of `pending`/`state`/`error`.

### Serialization round-trips

Server-action arguments and return values cross the wire via [seroval](https://github.com/lxsmnsyc/seroval) (see [Architecture](./architecture.md#6-server-action-serialization)). `packages/solidstep/tests/serialize.test.ts` round-trips values through `serializeToStream` + `SerovalChunkReader` to verify that types like `Date`, `FormData`, and `Promise` survive, and that the 12-byte length-prefixed framing reassembles correctly across split reads. This is the level at which to test custom serializable values.

## Component testing with `@solidjs/testing-library`

Component specs use `render` from [`@solidjs/testing-library`](https://github.com/solidjs/solid-testing-library) (a devDependency of the framework package) under the jsdom environment. From `packages/solidstep/tests/form.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render } from '@solidjs/testing-library';
import { Form } from '../utils/components/form';

it('calls the action with the form FormData on submit', async () => {
    const action = vi.fn(async () => {});
    const { container } = render(() => (
        <Form action={action}>
            <input name='name' value='ada' />
        </Form>
    ));

    container.querySelector('form')!.requestSubmit();

    await vi.waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    const data = action.mock.calls[0][0] as FormData;
    expect(data.get('name')).toBe('ada');
});
```

`render` returns a `container` you can query with standard DOM APIs (or the Testing Library queries). Pass a thunk — `render(() => <Component/>)` — so the component runs inside a Solid root. The same file shows asserting on context-driven children (a `useFormStatus` probe rendered inside `<Form>`).

## End-to-end testing with Playwright

E2E tests run [Playwright](https://playwright.dev) against the **built, production** kitchen-sink app. The scripts live in `examples/kitchen-sink/package.json`:

```bash
pnpm test:e2e       # playwright test
pnpm test:e2e:ui    # playwright test --ui
```

A `pretest:e2e` script runs first; it builds the framework (`pnpm --filter solidstep build`) and then builds the app (`vinxi build`). Playwright's `webServer` (configured in `examples/kitchen-sink/playwright.config.ts`) starts the production server with `node .output/server/index.mjs` and waits for it before running the suite. Key config:

- `testDir: './tests'`, only the `chromium` project.
- `baseURL` is `http://localhost:3210` (override the port via the `PORT` env var).
- In CI: retries, single worker, the `github` reporter, and `reuseExistingServer` disabled.

A spec uses `page.goto` with paths relative to `baseURL` and asserts on visible content / URL / title. From `examples/kitchen-sink/tests/soft-nav.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('<Link> navigates without a full document reload', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('heading')).toHaveText('Kitchen Sink');

    // Mark the live document; a full reload would wipe this flag.
    await page.evaluate(() => { (window as any).__noReload = true; });
    let reloaded = false;
    page.on('load', () => { reloaded = true; });

    await page.getByRole('link', { name: 'About' }).click();

    await expect(page.getByTestId('heading')).toHaveText('About');
    await expect(page).toHaveURL(/\/about$/);
    await expect(page).toHaveTitle('About — Kitchen Sink');
    expect(reloaded).toBe(false);            // soft nav, no document reload
});
```

The suite uses `data-testid` attributes for stable selectors, asserts on the URL and `<title>` after navigation, and checks behaviors such as soft navigation, prefetch, transitions, parallel routes, SSG/ISR, PPR, deferred loaders, server actions, and progressive enhancement (one spec per concern under `examples/kitchen-sink/tests/`).

### Writing e2e tests for your own app

The kitchen-sink config is a good template: build your app for production, point Playwright's `webServer` at the built server output, set a `baseURL`, and assert on rendered output rather than implementation details. Add `data-testid` attributes to elements you want to target so selectors survive markup changes.

## Related

- [Architecture](./architecture.md) — the request lifecycle, soft navigation, and serialization details these tests exercise.
- [Data Loading](./data-loading.md) — authoring the loaders you unit-test.
- [Server Actions & Forms](./server-actions-and-forms.md) — authoring the actions and forms you test.
