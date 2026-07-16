---
'solidstep': minor
---

Add a `<ClientOnly>` JSX boundary (`solidstep/client-only`), a supported escape hatch for content that must never participate in SSR/hydration -- deferring `children()` until after client mount instead of gating a subtree with a signal-driven `<Show>`, which can desync SSR's comment-boundary markers from the client hydration walk and throw a hard hydration-mismatch error. Also adds a narrow `solid: { hot }` config passthrough to disable solid-refresh HMR injection for troubleshooting, and documents both alongside the existing `clientOnly` HOC.
