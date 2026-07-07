// `vinxi/routes` is a build-time-only Vite virtual module (its package export
// has no `import`/`default` condition — only `types` — so it has no runtime
// file to fall back to outside Vite's fs-router plugin). Tests exercising
// `server/route-manifest.ts` alias `vinxi/routes` to this file (see
// vitest.config.ts) so they can populate the array directly; production
// builds are unaffected since vitest.config.ts is never used by vinxi.
const fileRoutes: unknown[] = [];
export default fileRoutes;
