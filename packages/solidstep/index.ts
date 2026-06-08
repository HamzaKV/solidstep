import type { AppOptions } from 'vinxi';
import { createApp } from 'vinxi';
import solid from 'vite-plugin-solid';
// @ts-expect-error
import { serverFunctions } from '@vinxi/server-functions/plugin';
import { ServerRouter, ClientRouter } from './utils/router.js';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { normalize } from 'vinxi/lib/path';
import type { LoggerOptions } from 'pino';
import type { CustomizableConfig } from 'vinxi/dist/types/lib/vite-dev';
// @ts-ignore
import type { InlineConfig } from 'vite';
import { config as viteConfigPlugin } from 'vinxi/plugins/config';

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
     * Extra Vite config merged into each router. Provide a single object to
     * apply it everywhere, or a function receiving the target `router` name to
     * vary config per router.
     */
    vite?:
        | ViteCustomizableConfig
        | ((options: {
              router: 'server' | 'client';
          }) => ViteCustomizableConfig);
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
    let middlewarePath = join(process.cwd(), 'app', 'middleware.ts');
    if (!existsSync(middlewarePath)) {
        middlewarePath = join(process.cwd(), 'app', 'middleware.js');
    }

    const sharedConfig = {
        logger: config.logger || false,
    };

    // @ts-ignore
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
                    solid({ ssr: true }),
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
                    serverFunctions.server(),
                    solid({ ssr: true }),
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
                            };
                        })(),
                    ),
                ],
                middleware: './app/middleware.ts',
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
            const serverDir = nitro.options.output.serverDir;
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
        }
    });

    return app;
};
