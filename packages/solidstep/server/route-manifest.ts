import { getManifest } from 'vinxi/manifest';
import fileRoutes, { type RouteModule } from 'vinxi/routes';
import {
    expandRoute,
    type PatternSegment,
    type PrerenderTarget,
} from '../utils/prerender';
import {
    createNode,
    insertRoute,
    type Import,
    type RoutePageHandler,
    type RouteNode,
} from '../utils/path-router';
import type { GenerateStaticParamsModule, OptionsModule } from './types';

// Module cache for dynamically imported modules — skipped in dev so HMR invalidations are respected
const moduleCache = new Map<string, unknown>();

export const getCachedModule = async <T>(importFn: Import): Promise<T> => {
    if (import.meta.env.DEV) {
        return importFn.import() as Promise<T>;
    }
    const key = importFn.src;
    if (moduleCache.has(key)) {
        return moduleCache.get(key) as T;
    }
    const module = (await importFn.import()) as T;
    moduleCache.set(key, module);
    return module;
};

export type FileRoute = RouteModule & {
    type:
        | 'route'
        | 'loading'
        | 'error'
        | 'not-found'
        | 'layout'
        | 'group'
        | 'metadata';
    $component: Import;
    $loader?: Import;
    $generateMeta?: Import;
    $handler?: Import;
    $options?: Import;
    $generateStaticParams?: Import;
    parent?: string; // for groups
    metaName?: string; // for metadata files (robots/sitemap/manifest/llms)
};

// Maps a metadata convention file to its served URL + Content-Type.
const METADATA_FILES: Record<string, { url: string; contentType: string }> = {
    robots: { url: '/robots.txt', contentType: 'text/plain; charset=utf-8' },
    sitemap: {
        url: '/sitemap.xml',
        contentType: 'application/xml; charset=utf-8',
    },
    manifest: {
        url: '/manifest.webmanifest',
        contentType: 'application/manifest+json; charset=utf-8',
    },
    llms: { url: '/llms.txt', contentType: 'text/plain; charset=utf-8' },
};

export type MetadataRoute = {
    url: string;
    contentType: string;
    handler: Import;
};

const isPageFile = (file: string) =>
    file.endsWith('page.tsx') ||
    file.endsWith('page.jsx') ||
    file.endsWith('page.ts') ||
    file.endsWith('page.js');

const isRouteFile = (file: string) =>
    file.endsWith('route.ts') || file.endsWith('route.js');

const getNormalizedPath = (path: string, clean?: boolean) => {
    const segments = path.split('/').slice(2);
    if (clean)
        return `/${segments.filter((s) => !s.startsWith('(')).join('/')}`;

    return `/${segments.join('/')}`;
};

export const createRouteManifest = async () => {
    const rootNode = createNode();

    const allRoutes: FileRoute[] = [];
    const layoutsMap = new Map<string, FileRoute>();
    const loadingPagesMap = new Map<string, FileRoute>();
    const errorPagesMap = new Map<string, FileRoute>();
    const groupsMap = new Map<string, FileRoute[]>();
    const metadataMap = new Map<string, MetadataRoute>();
    let notFoundPage: FileRoute | undefined;

    for (const fileRoute of fileRoutes as FileRoute[]) {
        if (fileRoute.type === 'route') {
            allRoutes.push(fileRoute);
        }

        if (
            fileRoute.type === 'metadata' &&
            fileRoute.metaName &&
            fileRoute.$handler
        ) {
            const def = METADATA_FILES[fileRoute.metaName];
            if (def) {
                metadataMap.set(def.url, {
                    url: def.url,
                    contentType: def.contentType,
                    handler: fileRoute.$handler,
                });
            }
        }

        if (fileRoute.type === 'layout') {
            const path = getNormalizedPath(fileRoute.path);
            layoutsMap.set(path, fileRoute);
        }

        if (fileRoute.type === 'not-found') {
            notFoundPage = fileRoute;
        }

        if (fileRoute.type === 'loading') {
            const path = getNormalizedPath(fileRoute.path);
            loadingPagesMap.set(path, fileRoute);
        }

        if (fileRoute.type === 'error') {
            const path = getNormalizedPath(fileRoute.path);
            errorPagesMap.set(path, fileRoute);
        }

        if (fileRoute.type === 'group') {
            // `fileRoute.parent` is already a clean route path (e.g. '/dashboard'
            // or '' for the root), so it must NOT go through getNormalizedPath,
            // which strips a leading prefix. Normalize it the same way page
            // routePaths are (drop '(group)' segments, ensure a leading slash) so
            // nested parallel routes attach to their parent route.
            const parentPath = `/${(fileRoute.parent || '')
                .split('/')
                .filter((s) => s && !s.startsWith('('))
                .join('/')}`;
            const existing = groupsMap.get(parentPath) || [];
            existing.push(fileRoute);
            groupsMap.set(parentPath, existing);
        }
    }

    const regex = /\?(?:pick=.*)*/g;

    for (const fileRoute of allRoutes) {
        const routePath = getNormalizedPath(fileRoute.path, true);
        const routeMatcherPath = getNormalizedPath(fileRoute.path);
        const src = fileRoute.$handler?.src.replace(regex, '');

        if (src && isPageFile(src)) {
            const loadingPage = loadingPagesMap.get(routeMatcherPath);
            const matchedGroups = groupsMap.get(routePath);

            const groups: RoutePageHandler['groups'] = {};
            if (matchedGroups && matchedGroups.length > 0) {
                for (const group of matchedGroups) {
                    const groupName = group.path
                        .split('/')
                        .filter((s) => !s.startsWith('('))
                        .at(-1);
                    if (!groupName) continue;
                    // A `loading.tsx`/`error.tsx` inside the @group dir was
                    // recognized as a normal loading/error route; look it up by
                    // the group's normalized path and attach it to the slot.
                    const groupNormPath = getNormalizedPath(group.path);
                    const groupLoading = loadingPagesMap.get(groupNormPath);
                    const groupError = errorPagesMap.get(groupNormPath);
                    groups[groupName] = {
                        manifestPath: group.path,
                        page: group.$component,
                        loader: group.$loader,
                        loadingPage: groupLoading?.$component,
                        errorPage: groupError?.$component,
                    };
                }
            }

            const segments = routeMatcherPath.split('/').filter(Boolean);
            let errorPage: FileRoute | undefined;
            const layouts: RoutePageHandler['layouts'] = [];

            // We need to traverse from root to leaf to build layouts order correctly?
            // Original code: i = segments.length down to 0. unshift matches.
            // i=length: /a/b/c. i=0: /.

            for (let i = segments.length; i >= 0; i--) {
                const path =
                    i === 0 ? '/' : `/${segments.slice(0, i).join('/')}`;

                if (!errorPage) {
                    errorPage = errorPagesMap.get(path);
                }
                const layout = layoutsMap.get(path);
                if (layout) {
                    layouts.unshift({
                        manifestPath: layout.path,
                        layout: layout.$component,
                        loader: layout.$loader,
                        generateMeta: layout.$generateMeta,
                    });
                }
            }

            const entry: RoutePageHandler = {
                type: 'page',
                mainPage: {
                    manifestPath: fileRoute.path,
                    page: fileRoute.$component,
                    loader: fileRoute.$loader,
                    generateMeta: fileRoute.$generateMeta,
                    options: fileRoute.$options,
                    generateStaticParams: fileRoute.$generateStaticParams,
                },
                loadingPage: loadingPage
                    ? {
                          page: loadingPage.$component,
                          generateMeta: loadingPage.$generateMeta,
                          manifestPath: loadingPage.path,
                      }
                    : undefined,
                errorPage: errorPage
                    ? {
                          page: errorPage.$component,
                          generateMeta: errorPage.$generateMeta,
                          manifestPath: errorPage.path,
                      }
                    : undefined,
                notFoundPage:
                    routePath === '/' && notFoundPage
                        ? {
                              page: notFoundPage.$component,
                              generateMeta: notFoundPage.$generateMeta,
                              manifestPath: notFoundPage.path,
                          }
                        : undefined,
                layouts: layouts,
                groups: groups,
            };

            insertRoute(rootNode, routePath, entry);
        } else if (src && isRouteFile(src)) {
            const entry = {
                type: 'route' as const,
                routePath,
                handler: fileRoute.$handler as Import,
                manifestPath: fileRoute.path,
            };

            insertRoute(rootNode, routePath, entry);
        }
    }

    return { rootNode, metadataMap };
};

// Walk the route trie, reconstructing each page route's pattern segments so a
// concrete pathname can be built from generateStaticParams.
export const walkPageRoutes = (
    node: RouteNode,
    segments: PatternSegment[] = [],
): { handler: RoutePageHandler; segments: PatternSegment[] }[] => {
    const out: { handler: RoutePageHandler; segments: PatternSegment[] }[] = [];
    if (node.handler && node.handler.type === 'page') {
        out.push({ handler: node.handler, segments });
    }
    for (const [value, child] of node.staticChildren) {
        out.push(
            ...walkPageRoutes(child, [...segments, { kind: 'static', value }]),
        );
    }
    if (node.paramChild) {
        out.push(
            ...walkPageRoutes(node.paramChild.node, [
                ...segments,
                { kind: 'param', name: node.paramChild.name },
            ]),
        );
    }
    if (node.catchAllChild) {
        out.push(
            ...walkPageRoutes(node.catchAllChild.node, [
                ...segments,
                {
                    kind: 'catchAll',
                    name: node.catchAllChild.name,
                    optional: node.catchAllChild.optional,
                },
            ]),
        );
    }
    return out;
};

// Shared mutable singletons, lazily initialized on first request and in
// `onStart`. They are owned by this module and mutated only through the
// accessors below, so the (identical) lazy-init/caching semantics are kept in
// one place while the functions that read them live across several modules.
let routeManifest: RouteNode | null = null;
let metadataManifest: Map<string, MetadataRoute> | null = null;
type Manifest = ReturnType<typeof getManifest>;
let clientManifest: Manifest | null = null;

// Lazily build (once) and return the route trie, mirroring the original
// `if (!routeManifest) { ... }` pattern. Also populates `metadataManifest`.
export const ensureRouteManifest = async (): Promise<RouteNode> => {
    if (!routeManifest) {
        const manifest = await createRouteManifest();
        routeManifest = manifest.rootNode;
        metadataManifest = manifest.metadataMap;
    }
    return routeManifest;
};

// Replace the cached manifests (used by `onStart`, which always rebuilds).
export const setRouteManifest = (
    rootNode: RouteNode,
    metadataMap: Map<string, MetadataRoute>,
): void => {
    routeManifest = rootNode;
    metadataManifest = metadataMap;
};

export const getMetadataManifest = (): Map<string, MetadataRoute> | null =>
    metadataManifest;

// Lazily resolve (once) and return the vinxi client manifest.
export const ensureClientManifest = (): Manifest => {
    if (!clientManifest) {
        clientManifest = getManifest('client');
    }
    return clientManifest;
};

/**
 * Enumerate every concrete page to prerender (SSG/ISR). For each page route
 * with `options.render` of `'static'`/`'isr'`, this loads its `options` and (for
 * dynamic routes) `generateStaticParams`, then expands the pattern into concrete
 * {@link PrerenderTarget}s. Used by the build-time crawler.
 */
export const collectPrerenderTargets = async (): Promise<PrerenderTarget[]> => {
    const manifest = await ensureRouteManifest();
    const targets: PrerenderTarget[] = [];
    for (const { handler, segments } of walkPageRoutes(manifest)) {
        const optionsImport = handler.mainPage.options;
        const options = optionsImport
            ? (await getCachedModule<OptionsModule>(optionsImport)).options
            : undefined;
        if (
            options?.render !== 'static' &&
            options?.render !== 'isr' &&
            options?.render !== 'ppr'
        )
            continue;

        let staticParams: Array<Record<string, string | string[]>> | undefined;
        const gspImport = handler.mainPage.generateStaticParams;
        if (gspImport) {
            const mod =
                await getCachedModule<GenerateStaticParamsModule>(gspImport);
            if (typeof mod.generateStaticParams === 'function') {
                staticParams = await mod.generateStaticParams();
            }
        }

        const expanded = expandRoute(segments, options, staticParams);
        if (
            expanded.length === 0 &&
            segments.some((s) => s.kind !== 'static')
        ) {
            console.warn(
                `[solidstep] Skipping prerender for dynamic route "/${segments
                    .map((s) => (s.kind === 'static' ? s.value : `[${s.name}]`))
                    .join(
                        '/',
                    )}" — render: '${options.render}' requires generateStaticParams.`,
            );
        }
        targets.push(...expanded);
    }
    return targets;
};
