---
'solidstep': patch
---

Fix: the generated server router's Vite config now sets `ssr.noExternal` for
`solidstep` itself. Without it, Vite's SSR dev/build pipeline externalizes
`solidstep` like any ordinary `node_modules` dependency, so files that import
Vite-only virtual specifiers (`vinxi/routes`, served exclusively by vinxi's own
`resolveId`/`load` plugin hooks with no runtime `exports` condition) hit Node's
real ESM resolver instead and throw `ERR_PACKAGE_PATH_NOT_EXPORTED`. This broke
any page rendering a `<Link>` (which transitively imports `client-manifest.ts`)
under `vinxi dev`. Production `vinxi build` was unaffected: build-time bundling
resolves the whole SSR graph (including virtual modules) through Vite's plugin
pipeline regardless of `noExternal`.
