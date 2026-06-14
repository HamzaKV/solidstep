import { BaseFileSystemRouter, cleanPath } from 'vinxi/fs-router';

/**
 * Vinxi file-system router definitions that turn files under `app/` into route
 * descriptors. SolidStep's conventions live here: a directory's URL path is
 * derived from its location, and the file's *suffix* selects its role —
 * `page` / `route` / `layout` / `error` / `loading` / `not-found`, plus the
 * root metadata files (`robots` / `sitemap` / `manifest` / `llms`) and `@group`
 * parallel-route directories. Each `toRoute` return value carries a `type`, a
 * synthetic `path` namespaced by role (e.g. `/route…`, `/layout…`) so different
 * roles for the same URL don't collide, and the lazy `$component` / `$loader` /
 * `$generateMeta` / `$handler` / `$options` / `$generateStaticParams` imports
 * the route needs (selected via Vinxi's `pick`).
 *
 * Two routers are exported because the server and client need different slices:
 * the {@link ServerRouter} exposes loaders, meta, handlers, options, and
 * static-params (everything SSR + API routes require), while the
 * {@link ClientRouter} exposes only `$component` (with its `$css`) — loaders
 * never run in the browser. Segments containing a `_`-prefixed part are treated
 * as private and excluded from routing in both.
 */

/**
 * Server-side file-system router. Recognizes API routes, root metadata files,
 * `@group` parallel routes, and the page/layout/error/loading/not-found
 * conventions, exposing the full set of server imports (loader, meta, handler,
 * options, static params) for each.
 */
export class ServerRouter extends BaseFileSystemRouter {
    /**
     * Map a source file to its clean URL path: strip the extension (via
     * `cleanPath`) and the trailing special-file suffix, falling back to `/`
     * for a root file.
     */
    toPath(src: string) {
        // `cleanPath` already strips the file extension. Stripping it again here
        // is not only redundant but harmful: the extension regex uses an
        // unescaped `.` (a wildcard), so on an already-extensionless path a root
        // file like `robots` (ends in `ts`) would have `ots` mangled away. Only
        // strip the special-file suffix here.
        const routePath = cleanPath(src, this.config).replace(
            /\/(page|route|layout|error|not-found|loading)$/,
            '',
        );

        return routePath?.length > 0 ? routePath : '/';
    }

    /**
     * Classify a single app file into a route descriptor (or `undefined` to
     * skip it). Files in a `_private` segment are ignored; otherwise the suffix
     * decides the role, checked in order: `route.ts`, root metadata files,
     * `@group` pages (their own `loading`/`error` fall through to the normal
     * recognition and are reattached to the group later), then
     * `page`/`layout`/`error`/`loading`/`not-found`. `not-found` is only
     * recognized at the root.
     */
    toRoute(filePath: string) {
        const normalizePath = cleanPath(filePath, this.config);
        const splitPath = normalizePath.split('/');
        const shouldIgnore = splitPath.some((part) => part.startsWith('_'));
        if (shouldIgnore) {
            return;
        }
        const path = this.toPath(filePath);

        if (/\/route\.(js|ts)$/.test(filePath)) {
            return {
                type: 'route',
                path: `/route${path}`,
                $handler: {
                    src: filePath,
                    pick: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
                },
            };
        }

        // Dynamic metadata files at the app root: robots / sitemap / manifest /
        // llms. Each exports a default returning the response body; the server
        // serves it at the conventional URL with the right Content-Type.
        const metadataMatch = filePath.match(
            /\/(robots|sitemap|manifest|llms)\.(js|ts)$/,
        );
        if (metadataMatch && path === `/${metadataMatch[1]}`) {
            return {
                type: 'metadata',
                metaName: metadataMatch[1],
                path: `/metadata/${metadataMatch[1]}`,
                $handler: {
                    src: filePath,
                    pick: ['default'],
                },
            };
        }

        // biome-ignore lint/correctness/noEmptyCharacterClassInRegex: <explanation>
        const scopedPackageMatch = path.match(/@[^]+/g);
        // A `@group` dir's `page` becomes a group route; its `loading`/`error`
        // fall through to the normal loading/error recognition below (they get
        // distinct paths and are reattached to the group in the manifest).
        if (
            scopedPackageMatch &&
            !/\/(loading|error)\.(jsx|js|tsx|ts)$/.test(filePath)
        ) {
            // Remove the scoped package part
            const scopedPackage = scopedPackageMatch[0];
            const parent = path.replace(`/${scopedPackage}`, '');
            return {
                type: 'group',
                parent: parent,
                path: `/group${path}`,
                $handler: {
                    src: filePath,
                    pick: [],
                },
                $component: {
                    src: filePath,
                    pick: ['default'],
                },
                $loader: {
                    src: filePath,
                    pick: ['loader'],
                },
                $options: {
                    src: filePath,
                    pick: ['options'],
                },
            };
        }

        if (/\/page\.(jsx|js|tsx|ts)$/.test(filePath)) {
            return {
                type: 'route',
                path: `/route${path}`,
                $handler: {
                    src: filePath,
                    pick: [],
                },
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
                $options: {
                    src: filePath,
                    pick: ['options'],
                },
                $generateStaticParams: {
                    src: filePath,
                    pick: ['generateStaticParams'],
                },
            };
        }

        if (/\/layout\.(jsx|js|tsx|ts)$/.test(filePath)) {
            return {
                type: 'layout',
                path: `/layout${path}`,
                $handler: {
                    src: filePath,
                    pick: [],
                },
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
                $options: {
                    src: filePath,
                    pick: ['options'],
                },
            };
        }

        if (/\/error\.(jsx|js|tsx|ts)$/.test(filePath)) {
            return {
                type: 'error',
                path: `/error${path}`,
                $handler: {
                    src: filePath,
                    pick: [],
                },
                $component: {
                    src: filePath,
                    pick: ['default'],
                },
                $generateMeta: {
                    src: filePath,
                    pick: ['generateMeta'],
                },
                $options: {
                    src: filePath,
                    pick: ['options'],
                },
            };
        }

        if (/\/loading\.(jsx|js|tsx|ts)$/.test(filePath)) {
            return {
                type: 'loading',
                path: `/loading${path}`,
                $handler: {
                    src: filePath,
                    pick: [],
                },
                $component: {
                    src: filePath,
                    pick: ['default'],
                },
                $generateMeta: {
                    src: filePath,
                    pick: ['generateMeta'],
                },
                $options: {
                    src: filePath,
                    pick: ['options'],
                },
            };
        }

        if (/\/not-found\.(jsx|js|tsx|ts)$/.test(filePath) && path === '/') {
            return {
                type: 'not-found',
                path: `/not-found${path}`,
                $handler: {
                    src: filePath,
                    pick: [],
                },
                $component: {
                    src: filePath,
                    pick: ['default'],
                },
                $generateMeta: {
                    src: filePath,
                    pick: ['generateMeta'],
                },
                $options: {
                    src: filePath,
                    pick: ['options'],
                },
            };
        }
    }
}

/**
 * Client-side file-system router. Recognizes the same `@group` and
 * page/layout/error/loading/not-found conventions as {@link ServerRouter} but
 * exposes only the `$component` import (with `$css`) — there are no loaders,
 * meta, handlers, or API routes in the browser bundle.
 */
export class ClientRouter extends BaseFileSystemRouter {
    /** Same URL derivation as {@link ServerRouter.toPath}. */
    toPath(src: string) {
        // See ServerRouter.toPath: `cleanPath` already removes the extension;
        // re-stripping with the wildcard `.` regex corrupts root file names.
        const routePath = cleanPath(src, this.config).replace(
            /\/(page|route|layout|error|not-found|loading)$/,
            '',
        );

        return routePath?.length > 0 ? routePath : '/';
    }

    /**
     * Classify a single app file into a client route descriptor (or
     * `undefined`). Mirrors {@link ServerRouter.toRoute}'s convention checks but
     * emits component-only descriptors and omits API routes and metadata files.
     */
    toRoute(filePath: string) {
        const normalizePath = cleanPath(filePath, this.config);
        const splitPath = normalizePath.split('/');
        const shouldIgnore = splitPath.some((part) => part.startsWith('_'));
        if (shouldIgnore) {
            return;
        }
        const path = this.toPath(filePath);

        // biome-ignore lint/correctness/noEmptyCharacterClassInRegex: <explanation>
        const scopedPackageMatch = path.match(/@[^]+/g);
        if (
            scopedPackageMatch &&
            !/\/(loading|error)\.(jsx|js|tsx|ts)$/.test(filePath)
        ) {
            // Remove the scoped package part
            const scopedPackage = scopedPackageMatch[0];
            const parent = path.replace(`/${scopedPackage}`, '');
            return {
                type: 'group',
                parent: parent,
                path: `/group${path}`,
                $component: {
                    src: filePath,
                    pick: ['default', '$css'],
                },
            };
        }

        if (/\/page\.(jsx|js|tsx|ts)$/.test(filePath)) {
            return {
                type: 'route',
                path: `/route${path}`,
                $component: {
                    src: filePath,
                    pick: ['default', '$css'],
                },
            };
        }

        if (/\/layout\.(jsx|js|tsx|ts)$/.test(filePath)) {
            return {
                type: 'layout',
                path: `/layout${path}`,
                $component: {
                    src: filePath,
                    pick: ['default', '$css'],
                },
            };
        }

        if (/\/error\.(jsx|js|tsx|ts)$/.test(filePath)) {
            return {
                type: 'error',
                path: `/error${path}`,
                $component: {
                    src: filePath,
                    pick: ['default', '$css'],
                },
            };
        }

        if (/\/loading\.(jsx|js|tsx|ts)$/.test(filePath)) {
            return {
                type: 'loading',
                path: `/loading${path}`,
                $component: {
                    src: filePath,
                    pick: ['default', '$css'],
                },
            };
        }

        if (/\/not-found\.(jsx|js|tsx|ts)$/.test(filePath) && path === '/') {
            return {
                type: 'not-found',
                path: `/not-found${path}`,
                $component: {
                    src: filePath,
                    // Include `$css` so the client manifest has the same variant
                    // the server looks up when rendering the not-found page.
                    pick: ['default', '$css'],
                },
            };
        }
    }
}
