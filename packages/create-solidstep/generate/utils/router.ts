import { BaseFileSystemRouter } from 'vinxi/fs-router';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export class Router extends BaseFileSystemRouter {
    toPath(src: string) {
        src = src
            .slice((__dirname + '/app').length);

        const routePath = src
            .replace(new RegExp(`\.(${(this.config.extensions ?? []).join('|')})$`), '')
            .replace(/\/(page|route|layout|error|not-found|loading)$/, '');

        return routePath?.length > 0 ? routePath : '/';
    }

    toRoute(filePath: string) {
        const path = this.toPath(filePath);

        if ((/route\.(js|ts)$/).test(filePath)) {
            return {
                type: 'route',
                path: '/route' + path,
                $handler: {
                    src: filePath,
                    pick: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
                },
            };
        }

        const scopedPackageMatch = path.match(/@[^]+/g);
        if (scopedPackageMatch) {
            // Remove the scoped package part
            const scopedPackage = scopedPackageMatch[0];
            const parent = path.replace('/' + scopedPackage, '');
            return {
                type: 'group',
                parent: parent,
                path: '/group' + path,
                $component: {
                    src: filePath,
                    pick: ['default'],
                },
                $loader: {
                    src: filePath,
                    pick: ['loader'],
                },
            };
        }

        if ((/page\.(jsx|js|tsx|ts)$/).test(filePath)) {
            return {
                type: 'route',
                path: '/route' + path,
                $component: {
                    src: filePath,
                    pick: ['default'],
                },
                $loader: {
                    src: filePath,
                    pick: ['loader'],
                },
                $generateMeta: {
                    src: filePath,
                    pick: ['generateMeta'],
                },
            };
        }

        if ((/layout\.(jsx|js|tsx|ts)$/).test(filePath)) {
            return {
                type: 'layout',
                path: '/layout' + path,
                $component: {
                    src: filePath,
                    pick: ['default'],
                },
                $loader: {
                    src: filePath,
                    pick: ['loader'],
                },
                $generateMeta: {
                    src: filePath,
                    pick: ['generateMeta'],
                },
            };
        }

        if ((/error\.(jsx|js|tsx|ts)$/).test(filePath)) {
            return {
                type: 'error',
                path: '/error' + path,
                $component: {
                    src: filePath,
                    pick: ['default'],
                },
                $generateMeta: {
                    src: filePath,
                    pick: ['generateMeta'],
                },
            };
        }

        if ((/loading\.(jsx|js|tsx|ts)$/).test(filePath)) {
            return {
                type: 'loading',
                path: '/loading' + path,
                $component: {
                    src: filePath,
                    pick: ['default'],
                },
                $generateMeta: {
                    src: filePath,
                    pick: ['generateMeta'],
                },
            };
        }

        if ((/not-found\.(jsx|js|tsx|ts)$/).test(filePath) && path === '/') {
            return {
                type: 'not-found',
                path: '/not-found' + path,
                $component: {
                    src: filePath,
                    pick: ['default'],
                },
                $generateMeta: {
                    src: filePath,
                    pick: ['generateMeta'],
                },
            };
        }
    }
}
