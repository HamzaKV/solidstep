import { createApp } from 'vinxi';
import solid from 'vite-plugin-solid';
import { serverFunctions } from '@vinxi/server-functions/plugin';
import { Router } from './utils/router';
import path from 'path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default createApp({
    server: {
    },
    routers: [
        {
            name: 'public',
            type: 'static',
            dir: './public',
            base: '/',
        },
        {
            name: 'ssr',
            type: 'http',
            base: '/',
            handler: './server.ts',
            target: 'server',
            plugins: () => [solid({ ssr: true })],
            link: {
				client: 'client',
			},
            middleware: './app/middleware.ts',
            routes: (router, app) => {
                return new Router(
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
            name: 'client',
            type: 'client',
            target: 'browser',
            handler: './client.ts',
            plugins: () => [serverFunctions.client(), solid({ ssr: true })],
            base: '/_build',
            routes: (router, app) => {
                return new Router(
                    {
                        dir: path.join(__dirname, 'app'),
                        extensions: ['jsx', 'js', 'tsx', 'ts'],
                    },
                    router,
                    app
                );
            }
        },
        serverFunctions.router(),
    ],
});
