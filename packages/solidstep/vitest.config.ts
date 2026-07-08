import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import solid from 'vite-plugin-solid';

export default defineConfig({
    // The Solid plugin compiles JSX/reactivity and resolves `solid-js` to its
    // client/dev build so component & hook tests can render under jsdom.
    plugins: [solid()],
    resolve: {
        alias: {
            // `vinxi/routes` has no runtime `import` condition (Vite-plugin-only
            // virtual module) — alias it to a fixture so tests/route-manifest.test.ts
            // can populate it directly. See tests/fixtures/vinxi-routes.ts.
            'vinxi/routes': fileURLToPath(
                new URL('./tests/fixtures/vinxi-routes.ts', import.meta.url),
            ),
        },
    },
    test: {
        // Global default; component/hook/serialize specs opt into jsdom with a
        // `// @vitest-environment jsdom` docblock so the pure-logic specs stay
        // on the faster node environment.
        environment: 'node',
        include: ['tests/**/*.test.{ts,tsx}'],
        // Solid must be transformed by Vite (not externalized) for reactivity
        // and `render()` to work correctly under test.
        server: {
            deps: {
                inline: [/solid-js/, /@solidjs\/testing-library/],
            },
        },
        coverage: {
            provider: 'v8',
            include: ['utils/**/*.ts', 'server/**/*.ts', 'server.ts'],
            exclude: [
                // client entry point tested implicitly via integration
                'utils/server-action.client.ts',
                // browser-coupled client router runtime (covered by e2e)
                'utils/router-context.ts',
                'utils/client-modules.ts',
                'utils/client-manifest.ts',
                'utils/components/link.ts',
                // build/dev Vite-plugin wrapper (fs/watcher); pure logic is unit-tested
                'utils/typegen.ts',
                'utils/fetch.client.ts',
                'utils/fetch.server.ts',
                'utils/logger.ts',
                'utils/cookies.ts',
                'utils/client-only.ts',
                'utils/meta.ts',
                'utils/options.ts',
                'utils/instrumentation.ts',
                'utils/instrumentation-noop.ts',
                // tightly coupled to Vinxi's file-system router internals
                'utils/router.ts',
                // types-only, no runtime logic
                'server/types.ts',
                // the render engine (variant selection, layout composition,
                // deferred/PPR result shaping) is spot-checked in
                // tests/render.test.ts and covered end-to-end by the
                // kitchen-sink e2e suite; forcing v8 100% branch coverage here
                // would mean mocking solid-js/web internals deeply enough to
                // couple the tests to render.ts's implementation rather than
                // its behavior.
                'server/render.ts',
            ],
            // Global thresholds sit just below 100% to make room for
            // branches that are genuinely unreachable from a unit test in
            // this environment — each has its own `/* v8 ignore */` (or
            // equivalent) comment in-source at its exact location explaining
            // why, so this list is a summary/pointer, not the source of
            // truth; if it and the source ever disagree, trust the source.
            // Vitest's per-glob threshold overrides don't help here: the
            // global aggregate always includes every file regardless of any
            // glob-specific entry, so a file can't be "exempted" from it.
            // Functions are still held to 100%. Remaining gaps, all covered
            // by the kitchen-sink e2e suite instead:
            //   - server.ts: a Windows/Nitro-bundle path fallback, a
            //     defensive empty-method guard, and the production-only 500
            //     fallback (import.meta.env.DEV is statically true here).
            //   - server/render-page.ts: the ISR short-circuit (same DEV
            //     gate), a dead branch impossible under path-router's actual
            //     matchRoute contract, and the same DEV-gated production
            //     rethrow.
            //   - server/route-manifest.ts: getCachedModule's production
            //     (non-DEV) module-cache branch.
            //   - server/data-endpoints.ts: the production (non-DEV)
            //     correlation-id logger.error branch for a soft-nav page
            //     loader failure.
            //   - utils/server-action.server.ts: the azure-functions-only
            //     ReadableStream request-body workaround (#1521/#1721, not
            //     exercisable under any other Nitro preset), a defensive
            //     `.body === undefined` check and an equally-defensive
            //     `status || 200` / `getResponseStatus() || 200` fallback (a
            //     native Response's status is spec'd to always be truthy).
            thresholds: {
                lines: 97,
                functions: 100,
                branches: 91,
                statements: 97,
            },
        },
    },
});
