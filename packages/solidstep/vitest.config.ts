import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['tests/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            include: ['utils/**/*.ts'],
            exclude: [
                // server/client entry points tested implicitly via integration
                'utils/server-action.server.ts',
                'utils/server-action.client.ts',
                'utils/diff-dom.ts',
                'utils/fetch.client.ts',
                'utils/fetch.server.ts',
                'utils/logger.ts',
                'utils/cookies.ts',
                'utils/redirect.ts',
                'utils/server-only.ts',
                'utils/client-only.ts',
                'utils/loader.ts',
                'utils/meta.ts',
                'utils/options.ts',
                'utils/instrumentation.ts',
                'utils/instrumentation-noop.ts',
                // tightly coupled to Vinxi's file-system router internals
                'utils/router.ts',
                'utils/components/**',
                'utils/hooks/**',
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
