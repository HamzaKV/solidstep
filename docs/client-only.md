# Client-Only Rendering

[← Back to docs index](./README.md)

SolidStep ships two different tools for keeping code and content client-side only. They solve different problems — pick based on what you're wrapping.

## `ClientOnly` — a JSX boundary for already-open interactive content

```tsx
import { ClientOnly } from 'solidstep/client-only';

<ClientOnly fallback={null}>
  {() => <HeavyMap markers={markers()} />}
</ClientOnly>
```

Renders `children()` only after the client has mounted — never during SSR, never during the hydration walk. `fallback` (optional, defaults to nothing) shows on the server and until mount.

`children` is a **function**, not a plain element — it's evaluated lazily, only once `ClientOnly` decides to mount it, so nothing inside is constructed before then.

Use this for content whose visibility is driven by a signal but that has no reason to exist in the SSR payload at all: a dialog's open/closed content, a dropdown's menu, a portal. Wrapping that kind of subtree in a top-level `<Show when={signal()}>` instead can throw a hydration-key mismatch (see [Troubleshooting](./troubleshooting.md#hydration-mismatch-from-show-as-a-top-level-visibility-toggle)) — `ClientOnly` sidesteps the problem entirely by never putting the content through hydration in the first place. The trade-off: that content genuinely isn't in the initial HTML, so it won't be visible to non-JS clients or crawlers, and there's a one-frame flash from `fallback` to real content on every mount (not just the first page load).

If the content *should* be part of the SSR payload (visible without JS, indexable, no mount flash) but is only ever shown/hidden — not created/destroyed — prefer the `classList` pattern from the Troubleshooting entry instead of `ClientOnly`.

## `clientOnly` — a HOC for deferring a whole component

```tsx
import clientOnly from 'solidstep/utils/client-only';

const Chart = clientOnly(() => import('./Chart'), {
  fallback: <Spinner />,
});
```

Wraps a **component reference** (often a dynamic `import()`) so it only renders client-side, showing `fallback` during SSR and until mount. Use this for a whole component that's inherently browser-only (charting libraries, anything touching `window`/`document` at module scope) — as opposed to `ClientOnly`, which wraps already-mounted JSX content whose *visibility* toggles, `clientOnly` wraps a component whose *existence in the bundle's initial render path* should be deferred.

## Which one do I want?

| | `ClientOnly` | `clientOnly` |
|---|---|---|
| Wraps | Inline JSX (`children: () => JSX.Element`) | A component reference |
| Typical use | Dialog/dropdown/portal content toggled by a signal | A whole widget that's browser-only (charts, maps) |
| Import | `solidstep/client-only` | `solidstep/utils/client-only` |

## Related

- [Troubleshooting](./troubleshooting.md#hydration-mismatch-from-show-as-a-top-level-visibility-toggle) — the hydration-mismatch pattern this exists to avoid.
- [Performance](./performance.md) — keeping heavy client-only widgets out of the critical path.
- [Architecture](./architecture.md#7-client-hydration) — how hydration works under the hood.
