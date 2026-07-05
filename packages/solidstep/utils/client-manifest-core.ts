import {
    createNode,
    insertRoute,
    matchRoute,
    type RouteNode,
} from './path-router.js';

/**
 * Pure client route-manifest construction + matching, with NO `vinxi/routes`
 * import — so it is unit-testable in isolation. `client-manifest.ts` is a thin
 * wrapper that feeds it the real client `fileRoutes`.
 *
 * The normalization and trie construction mirror the server's
 * `createRouteManifest` exactly, so client matching agrees with the server 1:1
 * (required for hydration-safe navigation).
 */

/** A client component import (`{ src, import }`) as exposed on `fileRoutes`. */
export type ClientImport = {
    src: string;
    import: () => Promise<{ default: any; [key: string]: any }>;
};

/** The client-side analogue of `RoutePageHandler` (no server-only fields). */
export type ClientPageHandler = {
    type: 'page';
    mainPage: { manifestPath: string; page: ClientImport };
    loadingPage?: { manifestPath: string; page: ClientImport };
    errorPage?: { manifestPath: string; page: ClientImport };
    notFoundPage?: { manifestPath: string; page: ClientImport };
    layouts: { manifestPath: string; layout: ClientImport }[];
    groups: Record<
        string,
        {
            manifestPath: string;
            page: ClientImport;
            loadingPage?: ClientImport;
            errorPage?: ClientImport;
        }
    >;
};

export type ClientFileRoute = {
    path: string;
    type: 'route' | 'layout' | 'loading' | 'error' | 'not-found' | 'group';
    parent?: string;
    $component: ClientImport;
};

// Identical to `server.ts`'s `getNormalizedPath`: drop the first two segments
// (the `/route`|/layout|… prefix and the leading empty segment), and optionally
// strip `(group)` segments to produce the clean URL path.
export const getNormalizedPath = (path: string, clean?: boolean) => {
    const segments = path.split('/').slice(2);
    if (clean) {
        return `/${segments.filter((s) => !s.startsWith('(')).join('/')}`;
    }
    return `/${segments.join('/')}`;
};

/** Build the client route trie from a list of client `fileRoutes`. */
export const buildManifest = (routes: ClientFileRoute[]): RouteNode => {
    const rootNode = createNode();

    const pages: ClientFileRoute[] = [];
    const layoutsMap = new Map<string, ClientFileRoute>();
    const loadingMap = new Map<string, ClientFileRoute>();
    const errorMap = new Map<string, ClientFileRoute>();
    const groupsMap = new Map<string, ClientFileRoute[]>();
    let notFound: ClientFileRoute | undefined;

    for (const route of routes) {
        switch (route.type) {
            case 'route':
                pages.push(route);
                break;
            case 'layout':
                layoutsMap.set(getNormalizedPath(route.path), route);
                break;
            case 'loading':
                loadingMap.set(getNormalizedPath(route.path), route);
                break;
            case 'error':
                errorMap.set(getNormalizedPath(route.path), route);
                break;
            case 'not-found':
                notFound = route;
                break;
            case 'group': {
                const parentPath = `/${(route.parent || '')
                    .split('/')
                    .filter((s) => s && !s.startsWith('('))
                    .join('/')}`;
                const existing = groupsMap.get(parentPath) || [];
                existing.push(route);
                groupsMap.set(parentPath, existing);
                break;
            }
        }
    }

    for (const page of pages) {
        const routePath = getNormalizedPath(page.path, true);
        const routeMatcherPath = getNormalizedPath(page.path);

        const groups: ClientPageHandler['groups'] = {};
        for (const group of groupsMap.get(routePath) || []) {
            const groupName = group.path
                .split('/')
                .filter((s) => !s.startsWith('('))
                .at(-1);
            if (!groupName) continue;
            const groupNorm = getNormalizedPath(group.path);
            groups[groupName] = {
                manifestPath: group.path,
                page: group.$component,
                loadingPage: loadingMap.get(groupNorm)?.$component,
                errorPage: errorMap.get(groupNorm)?.$component,
            };
        }

        const segments = routeMatcherPath.split('/').filter(Boolean);
        const layouts: ClientPageHandler['layouts'] = [];
        let errorPage: ClientFileRoute | undefined;
        for (let i = segments.length; i >= 0; i--) {
            const path = i === 0 ? '/' : `/${segments.slice(0, i).join('/')}`;
            if (!errorPage) errorPage = errorMap.get(path);
            const layout = layoutsMap.get(path);
            if (layout) {
                layouts.unshift({
                    manifestPath: layout.path,
                    layout: layout.$component,
                });
            }
        }

        const loadingPage = loadingMap.get(routeMatcherPath);

        const handler: ClientPageHandler = {
            type: 'page',
            mainPage: { manifestPath: page.path, page: page.$component },
            loadingPage: loadingPage
                ? {
                      manifestPath: loadingPage.path,
                      page: loadingPage.$component,
                  }
                : undefined,
            errorPage: errorPage
                ? { manifestPath: errorPage.path, page: errorPage.$component }
                : undefined,
            notFoundPage:
                routePath === '/' && notFound
                    ? { manifestPath: notFound.path, page: notFound.$component }
                    : undefined,
            layouts,
            groups,
        };

        insertRoute(rootNode, routePath, handler as any);
    }

    return rootNode;
};

/** Match a pathname against a built client trie. */
export const matchInManifest = (
    rootNode: RouteNode,
    pathname: string,
): {
    handler: ClientPageHandler;
    params: Record<string, string | string[]>;
} | null => {
    const match = matchRoute(rootNode, pathname);
    if (!match || match.handler.type !== 'page') return null;
    return {
        handler: match.handler as unknown as ClientPageHandler,
        params: match.params,
    };
};

/** Get the root not-found page handler from a built client trie, if any. */
export const getNotFoundInManifest = (
    rootNode: RouteNode,
): ClientPageHandler['notFoundPage'] | undefined => {
    const match = matchRoute(rootNode, '/');
    if (match && match.handler.type === 'page') {
        return (match.handler as unknown as ClientPageHandler).notFoundPage;
    }
    return undefined;
};
