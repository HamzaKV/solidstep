---
'@varlabs/create-solidstep': patch
---

Add the package's first automated test suite: a Vitest test that scaffolds
a real app via `bin/main.ts` into a temp directory and asserts the expected
files exist, `package.json` has the right dependencies, and the generated
`app/middleware.ts` is syntactically valid TypeScript. Wired into `pnpm test`
at the repo root.
