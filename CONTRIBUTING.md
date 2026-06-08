# Contributing to SolidStep

Thanks for your interest in contributing! This is a pnpm monorepo containing the framework, the
project scaffolder, and an example app used for integration testing.

## Repository layout

| Path | Package | Purpose |
|------|---------|---------|
| `packages/solidstep` | `solidstep` | The framework (published to npm) |
| `packages/create-solidstep` | `@varlabs/create-solidstep` | Project scaffolding CLI (published to npm) |
| `examples/kitchen-sink` | `kitchen-sink` (private) | Comprehensive example + Playwright e2e harness |

## Prerequisites

- **Node.js** `>=20` (CI tests on 20 and 22)
- **pnpm** `10.19.0` (pinned via the `packageManager` field — run `corepack enable` to match it)

## Getting started

```bash
pnpm install
pnpm --filter solidstep build      # build the framework first (the example links to its dist/)
pnpm --filter kitchen-sink dev     # run the example app
```

## Common commands (run from the repo root)

| Command | What it does |
|---------|--------------|
| `pnpm lint` | Biome lint **and** format check (same as CI: `biome ci .`) |
| `pnpm format` | Auto-format the repo with Biome |
| `pnpm typecheck` | `tsc --noEmit` for `solidstep` and `create-solidstep` |
| `pnpm test` | Run the framework unit tests (Vitest) |
| `pnpm test:e2e` | Build the framework + example app, then run Playwright e2e |
| `pnpm build` | Build all publishable packages |

## Code style

- Formatting and linting are enforced by [Biome](https://biomejs.dev/) (`biome.json`): 4-space
  indent, single quotes, semicolons. Run `pnpm format` before committing.
- TypeScript runs in strict mode. Keep public APIs typed and exported through the package's
  `exports` map.
- CI runs `pnpm lint`, `pnpm typecheck`, `pnpm test`, and the Playwright e2e suite on every PR.

## Testing

- **Unit tests** live in `packages/solidstep/tests/` and run under Vitest with a 100% coverage
  threshold on the modules included in `vitest.config.ts`. Add tests next to the patterns already
  there.
- **End-to-end tests** live in `examples/kitchen-sink/tests/` and run under Playwright against a
  production build of the example app. If you change runtime behavior, add or update an e2e case.

## Releasing (Changesets + npm trusted publishing)

Versioning and changelogs are managed by [Changesets](https://github.com/changesets/changesets).
The pipeline is gated: the `Release` workflow runs only **after the `CI` workflow succeeds on
`main`** (via `workflow_run`), so a release can't happen unless lint, typecheck, unit tests, e2e,
and builds have all passed.

1. **With your change**, add a changeset describing the user-facing impact:

   ```bash
   pnpm changeset
   ```

   Select the affected package(s), choose `patch` / `minor` / `major`, and write a summary.
   Commit the generated file in `.changeset/` along with your code.

2. **On merge to `main`** (after CI passes), the `Release` workflow runs the Changesets action,
   which opens (or updates) a **"Version Packages"** PR. That PR bumps versions and writes each
   package's `CHANGELOG.md`.

3. **Merging the "Version Packages" PR** triggers publishing (`scripts/release.sh`): for each
   publishable package whose new version isn't on the registry yet, it builds and runs
   `npm publish ./dist --provenance`, then tags the released versions (e.g. `solidstep@0.5.0`) and
   pushes the tags. Both packages compile to `dist/` and are published from there.

The private `kitchen-sink` example is excluded from versioning and publishing.

### Authentication: npm trusted publishing (OIDC)

Publishing uses [npm trusted publishing](https://docs.npmjs.com/trusted-publishers) — **no
`NPM_TOKEN` secret is needed**. The workflow requests an OIDC token (`id-token: write`) and npm
authenticates the GitHub Actions run directly.

One-time setup on npmjs.com, **for each package** (`solidstep` and `@varlabs/create-solidstep`):

1. Go to the package page → **Settings** → **Trusted Publisher**.
2. Add a **GitHub Actions** publisher with:
   - **Repository owner:** `HamzaKV`
   - **Repository:** `solidstep`
   - **Workflow filename:** `release.yml`
3. Save.

Notes:
- Trusted publishing is configured on an **already-published** package, so this works for both
  packages (they already exist on npm). A brand-new package name must be published once the
  traditional way before a trusted publisher can be added.
- The workflow upgrades npm to the latest version (trusted publishing requires npm ≥ 11.5.1; the
  Node 22 runner ships an older npm).
- `--provenance` requires the repository to be **public**.

### Local / manual publish (fallback)

Trusted publishing only works inside CI. To publish manually, log in with `npm login` and run the
package's existing `roll` script, which builds and publishes from `dist/`:

```bash
pnpm --filter solidstep roll
```

## Pull requests

- Keep PRs focused. Fill out the PR template checklist.
- Ensure `pnpm lint`, `pnpm typecheck`, and `pnpm test` pass locally before pushing.
