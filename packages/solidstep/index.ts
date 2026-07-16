import type { AppOptions } from 'vinxi';
import { createApp } from 'vinxi';
import solid from 'vite-plugin-solid';
// @ts-expect-error
import { serverFunctions } from '@vinxi/server-functions/plugin';
import { ServerRouter, ClientRouter } from './utils/router.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { normalize } from 'vinxi/lib/path';
import type { LoggerOptions } from 'pino';
import type { CustomizableConfig } from 'vinxi/dist/types/lib/vite-dev';
// @ts-expect-error
import type { InlineConfig } from 'vite';
import { config as viteConfigPlugin } from 'vinxi/plugins/config';
import { routeTypegen } from './utils/typegen.js';

type VinxiViteServerOptions = Omit<
    InlineConfig['server'],
    'port' | 'strictPort' | 'host' | 'middlewareMode' | 'open'
>;

type ViteCustomizableConfig = CustomizableConfig & {
    server?: VinxiViteServerOptions;
};

/**
 * Configuration for a SolidStep application.
 */
type Config = {
    /** Vinxi server options (the `experimental` field is managed internally). */
    server?: Omit<AppOptions['server'], 'experimental'>;
    /**
     * Vite/Rollup plugins to inject into the generated routers. `type` selects
     * which router(s) receive the plugin: the `client` (browser) router, the
     * `server` (SSR) router, or `both`.
     */
    plugins?: {
        type: 'client' | 'server' | 'both';
        plugin: any;
    }[];
    /**
     * Logging configuration. Pass `true` for sensible defaults, or a Pino
     * `LoggerOptions` object to customize the shared logger (see `logger`).
     */
    logger?: true | LoggerOptions;
    /**
     * Select the built-in cache backend used for the page-render and loader
     * data caches. Defaults to an in-memory LRU.
     *
     * - `{ type: 'memory', maxEntries, maxBytes }` — in-memory LRU (the default).
     *   `maxBytes` caps the approximate total value size (evicting LRU entries
     *   to stay under it) — useful on memory-constrained runtimes where an
     *   entry-count limit alone can hold far more than expected.
     * - `{ type: 'filesystem', dir }` — persist entries to disk under `dir`
     *   (node-server presets only).
     *
     * For an external store (e.g. Redis), call `setCacheStore(store)` from
     * `solidstep/utils/cache` inside your instrumentation `register()` hook —
     * that overrides whatever is selected here.
     */
    cache?:
        | { type?: 'memory'; maxEntries?: number; maxBytes?: number }
        | { type: 'filesystem'; dir: string };
    /**
     * Default timeout (ms) applied to every data loader: if a loader runs longer
     * it is aborted and rejects with a `LoaderTimeoutError` (a page loader then
     * renders `error.tsx`, a layout/group loader yields the error sentinel). A
     * per-loader `timeout` in `defineLoader` overrides this; omit for no global
     * timeout. The loader's abort signal is also wired to client disconnects.
     */
    loaderTimeout?: number;
    /**
     * Security-related defaults.
     */
    security?: {
        /**
         * Origin protection for server functions (`/_server`). On by default:
         * a request whose `Origin` or `Sec-Fetch-Site` header indicates a
         * cross-origin, untrusted caller is rejected with a 403 before the
         * action runs. A request with neither header (non-browser clients —
         * curl, mobile apps, server-to-server calls) is unaffected, since a
         * browser always sends at least one on a cross-origin request.
         */
        serverActions?: {
            /** Set `false` to disable the check entirely. Default `true`. */
            originCheck?: boolean;
            /**
             * Extra hosts (e.g. `'partner.example.com'`) allowed as
             * cross-origin callers despite the origin check.
             */
            trustedOrigins?: string[];
        };
    };
    /**
     * Extra Vite config merged into each router. Provide a single object to
     * apply it everywhere, or a function receiving the target `router` name to
     * vary config per router.
     */
    vite?:
        | ViteCustomizableConfig
        | ((options: {
              router: 'server' | 'client';
          }) => ViteCustomizableConfig);
    /**
     * Overrides for SolidStep's internal `vite-plugin-solid` invocation.
     * Currently exposes only `hot` — an escape hatch for troubleshooting
     * dev-mode HMR churn interacting with SSR hydration (see
     * docs/troubleshooting.md). Not a general options passthrough: `ssr`
     * is managed internally and no other option has a demonstrated need
     * yet.
     */
    solid?: {
        /** Disable solid-refresh HMR injection. Default `true` (enabled). */
        hot?: boolean;
    };
};

/**
 * Build a SolidStep application from a `Config`, returning the Vinxi `App`
 * exported by `app.config.ts`.
 *
 * Assembles a multi-router Vinxi app: a `static` router for `public/`, a
 * `client` router (browser bundle + Solid SSR/server-function client runtime),
 * and an `http` SSR router wired to the file-system `ServerRouter` and the
 * `app/middleware` file. User instrumentation (`app/instrumentation.{ts,js}`)
 * is aliased in when present, otherwise a no-op is used. The resolved logger
 * config is stored on `globalThis` and persisted to the build output so it is
 * available at runtime.
 *
 * @param config - Server, plugin, logger, and Vite options.
 * @returns The configured Vinxi `App`.
 *
 * @example
 * ```ts
 * // app.config.ts
 * import { defineConfig } from 'solidstep';
 *
 * export default defineConfig({
 *   server: { preset: 'node-server' },
 *   logger: true,
 * });
 * ```
 */
export const defineConfig = (
    config: Config = {
        server: {},
        plugins: [],
        vite: {},
    },
) => {
    // The ssr router's `middleware` field is resolved by vinxi relative to the
    // project root, matching the shape of the hardcoded literal below — not
    // the absolute `join(process.cwd(), ...)` paths used only for the
    // existence checks.
    const middlewarePath = existsSync(
        join(process.cwd(), 'app', 'middleware.ts'),
    )
        ? './app/middleware.ts'
        : existsSync(join(process.cwd(), 'app', 'middleware.js'))
          ? './app/middleware.js'
          : undefined;

    const sharedConfig = {
        logger: config.logger || false,
        cache: config.cache,
        loaderTimeout: config.loaderTimeout,
        security: config.security,
    };

    // @ts-expect-error
    globalThis.__SOLIDSTEP_CONFIG__ = sharedConfig;

    const viteConfig = (
        typeof config.vite === 'function'
            ? config.vite
            : () => config.vite || {}
    ) as (options: { router: 'server' | 'client' }) => ViteCustomizableConfig;

    const app = createApp({
        server: {
            ...config.server,
            experimental: {
                asyncContext: true,
            },
        },
        routers: [
            {
                name: 'public',
                type: 'static',
                dir: './public',
                base: '/',
            },
            {
                name: 'client',
                type: 'client',
                target: 'browser',
                handler: normalize(
                    fileURLToPath(new URL('./client.js', import.meta.url)),
                ),
                plugins: () => [
                    ...(config.plugins
                        ?.filter(
                            (p) => p.type === 'client' || p.type === 'both',
                        )
                        .map((p) => p.plugin) || []),
                    serverFunctions.client({
                        runtime: normalize(
                            fileURLToPath(
                                new URL(
                                    './utils/server-action.client.js',
                                    import.meta.url,
                                ),
                            ),
                        ),
                    }),
                    solid({ ssr: true, hot: config.solid?.hot }),
                    viteConfigPlugin('app-client', {
                        ...(viteConfig({ router: 'client' }) || {}),
                    }),
                ],
                base: '/_build',
                routes: (router, app) => {
                    return new ClientRouter(
                        {
                            dir: join(process.cwd(), 'app'),
                            extensions: ['jsx', 'js', 'tsx', 'ts'],
                        },
                        router,
                        app,
                    );
                },
            },
            {
                name: 'ssr',
                type: 'http',
                base: '/',
                handler: normalize(
                    fileURLToPath(new URL('./server.js', import.meta.url)),
                ),
                target: 'server',
                plugins: () => [
                    ...(config.plugins
                        ?.filter(
                            (p) => p.type === 'server' || p.type === 'both',
                        )
                        .map((p) => p.plugin) || []),
                    // Typed-routes codegen: emits `solidstep-env.d.ts` in dev + build.
                    routeTypegen(),
                    serverFunctions.server(),
                    solid({ ssr: true, hot: config.solid?.hot }),
                    viteConfigPlugin(
                        'app-server',
                        (() => {
                            const userServerVite =
                                viteConfig({ router: 'server' }) || {};
                            const instrumentationPath = (() => {
                                const userInstrumentationTs = join(
                                    process.cwd(),
                                    'app',
                                    'instrumentation.ts',
                                );
                                const userInstrumentationJs = join(
                                    process.cwd(),
                                    'app',
                                    'instrumentation.js',
                                );
                                if (existsSync(userInstrumentationTs)) {
                                    return userInstrumentationTs;
                                }
                                if (existsSync(userInstrumentationJs)) {
                                    return userInstrumentationJs;
                                }
                                return normalize(
                                    fileURLToPath(
                                        new URL(
                                            './utils/instrumentation-noop.js',
                                            import.meta.url,
                                        ),
                                    ),
                                );
                            })();
                            const userNoExternal =
                                userServerVite.ssr?.noExternal;
                            const mergedNoExternal = Array.isArray(
                                userNoExternal,
                            )
                                ? [...userNoExternal, 'solidstep']
                                : userNoExternal === true
                                  ? true
                                  : ['solidstep'];
                            return {
                                ...userServerVite,
                                resolve: {
                                    ...userServerVite.resolve,
                                    alias: {
                                        instrumentation: instrumentationPath,
                                        ...(userServerVite.resolve?.alias ||
                                            {}),
                                    },
                                },
                                ssr: {
                                    ...userServerVite.ssr,
                                    // `solidstep` (and its subpath imports, e.g.
                                    // `solidstep/link`) must be processed through
                                    // Vite's own module graph, not externalized to a
                                    // raw Node `import()`: some of its files import
                                    // Vite-only virtual specifiers (`vinxi/routes`,
                                    // served by vinxi's own resolveId/load plugin
                                    // hooks) that have no runtime resolution outside
                                    // Vite's plugin pipeline and throw
                                    // ERR_PACKAGE_PATH_NOT_EXPORTED under Node's real
                                    // ESM resolver.
                                    noExternal: mergedNoExternal,
                                },
                            };
                        })(),
                    ),
                ],
                middleware: middlewarePath,
                routes: (router, app) => {
                    return new ServerRouter(
                        {
                            dir: join(process.cwd(), 'app'),
                            extensions: ['jsx', 'js', 'tsx', 'ts'],
                        },
                        router,
                        app,
                    );
                },
            },
        ],
    });

    app.hooks.afterEach((event) => {
        if (event.name === 'app:build:nitro:end') {
            const [{ nitro }] = event.args;
            const serverDir = nitro.options.output.serverDir as string;
            const publicDir =
                (nitro.options.output.publicDir as string | undefined) ??
                join(dirname(serverDir), 'public');
            writeFileSync(
                `${serverDir}/.config.json`,
                JSON.stringify(sharedConfig),
                'utf-8',
            );
            const fromDir = join(process.cwd(), 'server-assets');
            if (existsSync(fromDir)) {
                const toDir = join(serverDir, 'server-assets');
                mkdirSync(toDir, { recursive: true });
                cpSync(fromDir, toDir, {
                    recursive: true,
                    force: true,
                });
                console.log(
                    `✔ Copied server assets from ${fromDir} to ${toDir}`,
                );
            } else {
                console.log(`ℹ No server assets to copy from ${fromDir}`);
            }

            // SSG/ISR: run the prerender crawler synchronously (spawnSync blocks)
            // so the build waits for it. This `afterEach` callback is invoked
            // synchronously by hookable and its returned promise is NOT awaited,
            // so the crawl must not be async here — hence a blocking child.
            const crawlScript = fileURLToPath(
                new URL('./prerender-crawl.js', import.meta.url),
            );
            const result = spawnSync(
                process.execPath,
                [crawlScript, serverDir, publicDir],
                { stdio: 'inherit' },
            );
            if (result.error) {
                console.warn(
                    'ℹ Prerender step failed (non-fatal):',
                    result.error,
                );
            }
        }
    });

    return app;
};
