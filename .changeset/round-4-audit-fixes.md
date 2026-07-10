---
"solidstep": patch
"@varlabs/create-solidstep": patch
---

Fix a route typegen bug that generated invalid TypeScript for kebab-case route
params or apostrophes in folder names, corrupting the app-wide `.d.ts`. Add a
timeout to the batched PPR hole fetch so a hung server response no longer
spins a Suspense boundary forever. Fix a redirecting server action still
throwing afterward, which fired spurious error signals mid-navigation. Fix the
dev error overlay crashing on a non-string `Error#name`/`#message`. Fix `<Link
prefetch>` not reacting to the prop changing after mount (hover/focus
handlers and the viewport `IntersectionObserver` were only wired up from the
value present at initial render). Make the route trie reject (instead of
silently colliding) a route nested under a catch-all folder, e.g.
`app/shop/[[...slug]]/checkout/page.tsx` -- that shape was never reachable
and previously overwrote its sibling route's handler with no warning.

`@varlabs/create-solidstep`: pin the scaffolded app's `solidstep` dependency
to `^1.0.0` instead of `latest`; remove the unused `inquirer` dependency; run
this package's own test suite in CI (it was previously never executed).
