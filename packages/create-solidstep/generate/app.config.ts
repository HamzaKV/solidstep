import { createApp } from 'vinxi';
import solid from 'vite-plugin-solid';
import { serverFunctions } from '@vinxi/server-functions/plugin';
import { ServerRouter, ClientRouter } from './utils/router';
import path from 'path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { normalize } from 'vinxi/lib/path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = createApp({
    server: {
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
            handler: './client.ts',
            plugins: () => [
                serverFunctions.client({
                    runtime: normalize(
                        fileURLToPath(new URL('./utils/server-action.client.ts', import.meta.url)),
                    ),
                }),
                solid({ ssr: true }),
            ],
            base: '/_build',
            routes: (router, app) => {
                return new ClientRouter(
                    {
                        dir: path.join(__dirname, 'app'),
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
            handler: './server.ts',
            target: 'server',
            plugins: () => [
                serverFunctions.server(),
                solid({ ssr: true }),
            ],
            // link: {
			// 	client: 'client',
			// },
            middleware: './app/middleware.ts',
            routes: (router, app) => {
                return new ServerRouter(
                    {
                        dir: path.join(__dirname, 'app'),
                        extensions: ['jsx', 'js', 'tsx', 'ts'],
                    },
                    router,
                    app
                );
            }
        },
        // serverFunctions.router(),
    ],
});

app.hooks.afterEach(event => {
    if (event.name === 'app:build:nitro:end') {
        const [{ nitro }] = event.args;
        const serverDir = nitro.options.output.serverDir;
        const fromDir = path.join(process.cwd(), 'server-assets');
        if (existsSync(fromDir)) {
            const toDir = path.join(serverDir, 'server-assets');
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

export default app;
