import { defineConfig } from 'vitest/config';
import solid from 'vite-plugin-solid';

export default defineConfig({
    // The Solid plugin compiles JSX/reactivity and resolves `solid-js` to its
    // client/dev build so component & hook tests can render under jsdom.
    plugins: [solid()],
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
            include: ['utils/**/*.ts'],
            exclude: [
                // server/client entry points tested implicitly via integration
                'utils/server-action.server.ts',
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
            ],
            thresholds: {
                lines: 100,
                functions: 100,
                branches: 100,
                statements: 100,
            },
        },
    },
});
