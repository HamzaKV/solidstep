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

type Config = {
    server?: Omit<AppOptions['server'], 'experimental'>;
    plugins?: {
        type: 'client' | 'server' | 'both';
        plugin: any;
    }[];
    logger?: true | LoggerOptions;
};

export const defineConfig = (config: Config = {
    server: {},
    plugins: [],
}) => {
    let middlewarePath = join(process.cwd(), 'app', 'middleware.ts');
    if (!existsSync(middlewarePath)) {
        middlewarePath = join(process.cwd(), 'app', 'middleware.js');
    }

    const sharedConfig = {
        logger: config.logger || false,
    };

    // @ts-ignore
    globalThis.__SOLIDSTEP_CONFIG__ = sharedConfig;

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
                        ?.filter(p => p.type === 'client' || p.type === 'both')
                        .map(p => p.plugin) || []),
                    serverFunctions.client({
                        runtime: normalize(
                            fileURLToPath(new URL('./utils/server-action.client.js', import.meta.url)),
                        ),
                    }),
                    solid({ ssr: true }),
                ],
                base: '/_build',
                routes: (router, app) => {
                    return new ClientRouter(
                        {
                            dir: join(process.cwd(), 'app'),
                            extensions: ['jsx', 'js', 'tsx', 'ts'],
                        },
                        router,
                        app
                    );
                }
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
                        ?.filter(p => p.type === 'server' || p.type === 'both')
                        .map(p => p.plugin) || []),
                    serverFunctions.server(),
                    solid({ ssr: true }),
                ],
                middleware: './app/middleware.ts',
                routes: (router, app) => {
                    return new ServerRouter(
                        {
                            dir: join(process.cwd(), 'app'),
                            extensions: ['jsx', 'js', 'tsx', 'ts'],
                        },
                        router,
                        app
                    );
                }
            },
        ],
    });

    app.hooks.afterEach(event => {
        if (event.name === 'app:build:nitro:end') {
            const [{ nitro }] = event.args;
            const serverDir = nitro.options.output.serverDir;
            writeFileSync(`${serverDir}/.config.json`, JSON.stringify(sharedConfig), 'utf-8');
            const fromDir = join(process.cwd(), 'server-assets');
            if (existsSync(fromDir)) {
                const toDir = join(serverDir, 'server-assets');
                mkdirSync(toDir, { recursive: true });
                cpSync(fromDir, toDir, {
                    recursive: true,
                    force: true,
                });
                console.log(`✔ Copied server assets from ${fromDir} to ${toDir}`);
            } else {
                console.log(`ℹ No server assets to copy from ${fromDir}`);
            }
        }
    });

    return app;
};
