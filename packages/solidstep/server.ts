import {
    eventHandler,
    getResponseStatus,
    toWebRequest,
    setHeader,
    setResponseStatus,
} from 'vinxi/http';
import { getManifest } from 'vinxi/manifest';
import {
    generateHydrationScript,
    renderToString,
    renderToStream,
    createComponent,
} from 'solid-js/web';
import { Suspense } from 'solid-js';
import { createDeferredResource } from './utils/deferred';
import type { Meta } from './utils/meta';
import fileRoutes, { type RouteModule } from 'vinxi/routes';
import { RedirectError } from './utils/redirect';
import { setCache, getCache } from './utils/cache';
import { getCachedLoaderData } from './utils/loader-cache';
import { handleServerFunction } from './utils/server-action.server';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    createNode,
    insertRoute,
    matchRoute,
    type Import,
    type RoutePageHandler,
    type RouteNode,
} from './utils/path-router';
import {
    loadInstrumentation,
    getInstrumentation,
    safeExecuteHook,
    createRequestContext,
    createResponseContext,
} from './utils/instrumentation';

let instrumentationReady: Promise<void> | null = null;

// Module cache for dynamically imported modules — skipped in dev so HMR invalidations are respected
const moduleCache = new Map<string, any>();

const getCachedModule = async <T>(importFn: Import): Promise<T> => {
    if (import.meta.env.DEV) {
        return importFn.import() as Promise<T>;
    }
    const key = importFn.src;
    if (moduleCache.has(key)) {
        return moduleCache.get(key);
    }
    const module = await importFn.import();
    moduleCache.set(key, module);
    return module;
};

type FileRoute = RouteModule & {
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

type MetadataRoute = { url: string; contentType: string; handler: Import };

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

const createRouteManifest = async () => {
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
                    groups[groupName] = {
                        manifestPath: group.path,
                        page: group.$component,
                        loader: group.$loader,
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

const template = `
    <!DOCTYPE html>
    <html lang="en">
    <head><!--app-head--></head>
    <!--app-body-->
    </html>
`;

const generateHtmlHead = (meta: Meta) => {
    const head = Object.entries(meta)
        .map(([key, value]) => {
            if (value.type === 'title') {
                return `<title>${value.content}</title>`;
            }

            if (value.type === 'meta') {
                const attrs = Object.entries(value.attributes)
                    .map(([attrKey, attrValue]) => `${attrKey}="${attrValue}"`)
                    .join(' ');
                return `<meta ${attrs}>`;
            }

            if (
                value.type === 'link' ||
                value.type === 'style' ||
                value.type === 'script'
            ) {
                const attrs = Object.entries(value.attributes)
                    .map(([attrKey, attrValue]) => `${attrKey}="${attrValue}"`)
                    .join(' ');
                return `<${value.type} ${attrs}></${value.type}>`;
            }
            return '';
        })
        .join('\n');
    return head;
};

const render = async ({
    toRender,
    entry,
    routeParams,
    searchParams,
    req,
    pageOptions,
    cspNonce,
    error,
}: {
    toRender: 'main' | 'loading' | 'error' | 'not-found';
    entry: RoutePageHandler;
    routeParams: Record<string, string | string[]>;
    searchParams: Record<string, string>;
    req: Request;
    pageOptions: Record<string, any>;
    cspNonce?: string;
    error?: Error;
}) => {
    const url = new URL(req.url);
    const path = url.pathname;
    const cachedEntry = getCache<{
        rendered: string;
        documentMeta: Meta;
        documentAssets: any[];
        loaderData: Record<string, any>;
    }>(path);

    if (cachedEntry && toRender === 'main') {
        return {
            rendered: cachedEntry.rendered,
            documentMeta: cachedEntry.documentMeta,
            documentAssets: cachedEntry.documentAssets,
            loaderData: cachedEntry.loaderData,
        };
    }

    type CacheOptions = {
        ttl: number;
    };
    let meta: Meta = {};
    const loaderData: Record<string, any> = {};
    const clientManifest = getManifest('client');
    const assets: any[] = [];

    // Select the page variant being rendered up front so its loader can be
    // pre-resolved alongside the layout loaders.
    const pageToRender: any =
        toRender === 'loading'
            ? entry.loadingPage
            : toRender === 'error'
              ? entry.errorPage
              : toRender === 'not-found'
                ? entry.notFoundPage
                : entry.mainPage;

    // Run every layout loader and the page loader concurrently instead of
    // sequentially down the layout chain. Results are keyed by manifestPath and
    // applied in tree order below, so loaderData ordering and per-node data are
    // unchanged — only the awaits now overlap.
    const loaderTargets: { manifestPath: string; loader: any }[] = [];
    for (const layout of entry.layouts) {
        if (layout.loader) {
            loaderTargets.push({
                manifestPath: layout.manifestPath,
                loader: layout.loader,
            });
        }
    }
    if (pageToRender?.loader) {
        loaderTargets.push({
            manifestPath: pageToRender.manifestPath,
            loader: pageToRender.loader,
        });
    }
    // A `$loader` import is created for every layout/page node, even when the
    // file exports no loader — in that case the picked module is empty and has
    // no `loader` export, so we skip it. Only nodes whose loader actually ran
    // get an entry here, which is how the closures below decide whether to
    // populate loaderData (matching the previous in-closure behavior).
    const resolvedLoaderData = new Map<string, any>();
    // Deferred loaders (`type: 'defer'`) are started but NOT awaited here; their
    // promise is handed to a Solid resource so the component can stream it in
    // under `<Suspense>`. Sequential loaders are awaited as before.
    const deferredLoaderData = new Map<string, Promise<any>>();
    await Promise.all(
        loaderTargets.map(async ({ manifestPath, loader }) => {
            const { loader: loaderFn } = await getCachedModule<{ loader: any }>(
                loader,
            );
            if (!loaderFn) return;
            // Only the page loader supports `defer` for now; layout loaders are
            // always awaited (sequential).
            const isDeferred =
                loaderFn.options?.type === 'defer' &&
                manifestPath === pageToRender?.manifestPath;
            if (isDeferred) {
                const pending = getCachedLoaderData(
                    loaderFn,
                    manifestPath,
                    req,
                );
                // Swallow rejections here; the resource created from this promise
                // re-observes it and routes the error to a Suspense/ErrorBoundary.
                pending.catch(() => undefined);
                deferredLoaderData.set(manifestPath, pending);
                return;
            }
            const data = await getCachedLoaderData(loaderFn, manifestPath, req);
            resolvedLoaderData.set(manifestPath, data);
        }),
    );
    const hasDeferred = deferredLoaderData.size > 0;

    const compose = entry.layouts.reduceRight(
        (children, layout, index) => async () => {
            const moduleSrc = `${layout.layout.src}&pick=$css`;
            const moduleAssets =
                await clientManifest.inputs[moduleSrc].assets();
            assets.push(...moduleAssets);
            const { default: layoutModule } = await getCachedModule<{
                default: any;
            }>(layout.layout);
            const { generateMeta: generateMetaPage } = layout.generateMeta
                ? await getCachedModule<{ generateMeta: any }>(
                      layout.generateMeta,
                  )
                : { generateMeta: null };
            let data = {};
            if (generateMetaPage) {
                const metaData = await generateMetaPage({
                    req,
                    cspNonce,
                });
                if (metaData) {
                    meta = {
                        ...meta,
                        ...metaData,
                    };
                }
            }
            if (resolvedLoaderData.has(layout.manifestPath)) {
                data = resolvedLoaderData.get(layout.manifestPath);
                loaderData[layout.manifestPath] = data;
            }
            const slots: Record<string, any> = {};
            const slotPromises: any[] = [children()];
            if (index === entry.layouts.length - 1) {
                // last layout, we can render slots
                const groups = entry.groups || {};
                for (const [groupName, group] of Object.entries(groups)) {
                    slotPromises.push(
                        (async () => {
                            const moduleSrc = `${group.page.src}&pick=$css`;
                            const moduleAssets =
                                await clientManifest.inputs[moduleSrc].assets();
                            assets.push(...moduleAssets);
                            const { default: groupPage } =
                                await getCachedModule<{ default: any }>(
                                    group.page,
                                );
                            const { loader: groupLoader } = group.loader
                                ? await getCachedModule<{ loader: any }>(
                                      group.loader,
                                  )
                                : { loader: null };
                            let data: any = {};
                            if (groupLoader) {
                                data = await getCachedLoaderData(
                                    groupLoader,
                                    group.manifestPath,
                                    req,
                                );
                                loaderData[group.manifestPath] = data;
                            }
                            slots[groupName.replace('@', '')] = () =>
                                groupPage({
                                    routeParams,
                                    searchParams,
                                    loaderData: data,
                                });
                        })(),
                    );
                }
            }
            const [childrenRendered] = await Promise.all(slotPromises);
            return () =>
                layoutModule({
                    children: childrenRendered,
                    routeParams,
                    searchParams,
                    loaderData: data,
                    slots: slots,
                    locals: {
                        cspNonce: cspNonce,
                    },
                });
        },
        async () => {
            const moduleSrc = `${pageToRender.page.src}&pick=$css`;
            const moduleAssets =
                await clientManifest.inputs[moduleSrc].assets();
            assets.push(...moduleAssets);
            const { default: page } = await getCachedModule<{ default: any }>(
                pageToRender.page,
            );
            const { generateMeta } = pageToRender.generateMeta
                ? await getCachedModule<{ generateMeta: any }>(
                      pageToRender.generateMeta,
                  )
                : { generateMeta: null };

            let data = {};
            if (resolvedLoaderData.has(pageToRender.manifestPath)) {
                data = resolvedLoaderData.get(pageToRender.manifestPath);
                loaderData[pageToRender.manifestPath] = data;
            }
            if (generateMeta) {
                const metaData = await generateMeta({
                    req,
                    cspNonce,
                });
                if (metaData) {
                    meta = {
                        ...meta,
                        ...metaData,
                    };
                }
            }
            const props: any = {
                routeParams,
                searchParams,
                loaderData: data,
                locals: {
                    cspNonce: cspNonce,
                },
            };
            if (toRender === 'error') {
                props.error = error;
            }

            // Deferred page loader: stream its data in under <Suspense> instead
            // of blocking the shell. `loading.tsx` (if present) is the fallback.
            const deferredPromise = deferredLoaderData.get(
                pageToRender.manifestPath,
            );
            if (deferredPromise) {
                let LoadingFallback: any = null;
                if (entry.loadingPage) {
                    const loadingSrc = `${entry.loadingPage.page.src}&pick=$css`;
                    const loadingAssets =
                        await clientManifest.inputs[loadingSrc].assets();
                    assets.push(...loadingAssets);
                    const { default: lf } = await getCachedModule<{
                        default: any;
                    }>(entry.loadingPage.page);
                    LoadingFallback = lf;
                }
                return () => {
                    const resource = createDeferredResource(deferredPromise);
                    return createComponent(Suspense, {
                        fallback: LoadingFallback
                            ? createComponent(LoadingFallback, {
                                  routeParams,
                                  searchParams,
                              })
                            : undefined,
                        get children() {
                            return page({ ...props, loaderData: resource });
                        },
                    });
                };
            }
            return () => page(props);
        },
    );

    const composed = await compose();

    // Deferred route: hand the composed tree back to the caller to stream via
    // `renderToStream` (the page suspends on its deferred resource). Streamed
    // responses are not page-cached. `meta`/`assets` are fully populated by the
    // awaited `compose()` above, so the caller can emit the <head> first.
    if (hasDeferred && toRender === 'main') {
        return {
            deferred: true as const,
            composed,
            documentMeta: meta,
            documentAssets: assets,
            loaderData,
            deferredKeys: [...deferredLoaderData.keys()],
        };
    }

    const rendered = await renderToString(() => composed());

    if (toRender === 'main') {
        const options = pageOptions?.cache as CacheOptions | undefined;
        setCache(
            path,
            {
                rendered: rendered,
                documentMeta: meta,
                documentAssets: assets,
                loaderData: loaderData,
            },
            options?.ttl ? options.ttl : 0,
        );
    }

    return {
        rendered: rendered,
        documentMeta: meta,
        documentAssets: assets,
        loaderData: loaderData,
    };
};

// Whether a matched page route uses a deferred loader (page loader only, for
// now). The loader module is cached, so this import is cheap.
const hasDeferredLoaders = async (
    entry: RoutePageHandler,
): Promise<boolean> => {
    const loaderRef = entry.mainPage.loader;
    if (!loaderRef) return false;
    const { loader: loaderFn } = await getCachedModule<{ loader: any }>(
        loaderRef as Import,
    );
    return loaderFn?.options?.type === 'defer';
};

let routeManifest: RouteNode | null = null;
let metadataManifest: Map<string, MetadataRoute> | null = null;
type Manifest = ReturnType<typeof getManifest>;
let clientManifest: Manifest | null = null;

const hydrationScript = ({
    nonce,
}: {
    nonce?: string;
}) => {
    const script = generateHydrationScript();
    return nonce
        ? script.replace('<script', `<script nonce="${nonce}"`)
        : script;
};

const onStart = async () => {
    try {
        const manifest = await createRouteManifest();
        routeManifest = manifest.rootNode;
        metadataManifest = manifest.metadataMap;
        const sharedConfig = (globalThis as any).__SOLIDSTEP_CONFIG__;
        if (!sharedConfig) {
            const __dirname = dirname(fileURLToPath(import.meta.url));
            const configContent = await readFile(
                `${__dirname}/.config.json`,
                'utf-8',
            );
            // @ts-ignore
            globalThis.__SOLIDSTEP_CONFIG__ = JSON.parse(configContent);
        }
    } catch (e) {
        console.error('Error creating route manifest:', e);
    }

    // Load instrumentation
    const instrumentation = await loadInstrumentation();
    if (instrumentation?.register) {
        await safeExecuteHook('register', instrumentation.register);
    }
};

instrumentationReady = onStart();

const handler = eventHandler(async (event) => {
    if (instrumentationReady) await instrumentationReady;

    const req = toWebRequest(event);

    try {
        if (
            req.url.includes(
                '/.well-known/appspecific/com.chrome.devtools.json',
            )
        ) {
            setResponseStatus(204);
            return;
        }

        if (req.url?.includes('_server')) {
            return handleServerFunction(event);
        }

        if (!routeManifest) {
            const manifest = await createRouteManifest();
            routeManifest = manifest.rootNode;
            metadataManifest = manifest.metadataMap;
        }

        if (!clientManifest) {
            clientManifest = getManifest('client');
        }

        const cspNonce = (event as any).locals?.cspNonce as string | undefined;

        const urlObj = new URL(req.url);
        const pathnamePart = urlObj.pathname;
        const searchParams = Object.fromEntries(urlObj.searchParams);

        // Dynamic metadata files (robots.txt / sitemap.xml / manifest / llms.txt).
        // A matching static file in public/ is served by the static router first.
        const metaRoute = metadataManifest?.get(pathnamePart);
        if (metaRoute) {
            const mod = await getCachedModule<{
                default?: (req: Request) => unknown | Promise<unknown>;
            }>(metaRoute.handler);
            if (typeof mod.default === 'function') {
                const result = await mod.default(req);
                if (result instanceof Response) {
                    return result;
                }
                setHeader('Content-Type', metaRoute.contentType);
                return typeof result === 'string'
                    ? result
                    : JSON.stringify(result);
            }
        }

        const match = matchRoute(routeManifest, pathnamePart);
        const matched = match?.handler;
        const params = match?.params || {};

        if (matched && matched.type === 'route') {
            const inst = getInstrumentation();
            const reqCtx = createRequestContext(req, {
                routePath: (matched as any).routePath || 'unknown',
                routeType: 'api',
                params,
                searchParams,
            });
            await safeExecuteHook('onRequest', inst?.onRequest, req, reqCtx);

            try {
                const routeModule = await getCachedModule<Record<string, any>>(
                    matched.handler,
                );
                const reqMethod = req.method?.toUpperCase();
                if (reqMethod) {
                    const handler = routeModule[reqMethod];
                    if (typeof handler === 'function') {
                        const result = await handler(req, {
                            params: params,
                            searchParams: searchParams,
                        });
                        const respCtx = createResponseContext(
                            reqCtx,
                            getResponseStatus(event) || 200,
                        );
                        await safeExecuteHook(
                            'onResponseEnd',
                            inst?.onResponseEnd,
                            req,
                            respCtx,
                        );
                        return result;
                    }

                    throw new Error(
                        `Method ${reqMethod} not implemented in ${matched.handler.src}`,
                    );
                }
                throw new Error(`Unsupported request method: ${reqMethod}`);
            } catch (error) {
                await safeExecuteHook(
                    'onRequestError',
                    inst?.onRequestError as any,
                    error,
                    req,
                    reqCtx,
                );
                throw error;
            }
        }

        const inst = getInstrumentation();
        const reqCtx = createRequestContext(req, {
            routePath: matched ? pathnamePart : '/not-found',
            routeType: matched ? 'page' : 'not-found',
            params,
            searchParams,
        });
        await safeExecuteHook('onRequest', inst?.onRequest, req, reqCtx);

        let loading = false;
        let html: string | undefined = undefined;
        let meta: Meta = {
            charset: {
                type: 'meta',
                attributes: {
                    charset: 'UTF-8',
                },
            },
            viewport: {
                type: 'meta',
                attributes: {
                    name: 'viewport',
                    content: 'width=device-width, initial-scale=1.0',
                },
            },
            title: {
                type: 'title',
                attributes: {},
                content: 'SolidStep',
            },
            build_time: {
                type: 'meta',
                attributes: {
                    name: 'x-build-time',
                    content: Date.now().toString(),
                    description:
                        'IMPORTANT: This tag indicates the build time of the application and should not be removed.',
                },
            },
        };
        const assets =
            await clientManifest.inputs[clientManifest.handler].assets();
        const manifestHtml = `<script ${cspNonce ? `nonce="${cspNonce}"` : ''}>window.manifest=${JSON.stringify(await clientManifest.json())}</script>`;

        let clientHydrationScript: string | undefined = undefined;

        setHeader('Content-Type', 'text/html');
        setHeader('Cache-Control', 'no-cache');

        const stream = new ReadableStream({
            async start(controller) {
                const encoder = new TextEncoder();
                const push = (text: string) =>
                    controller.enqueue(encoder.encode(text));
                let streamError: unknown = null;

                try {
                    try {
                        if (!matched) {
                            try {
                                const match = matchRoute(
                                    routeManifest as any,
                                    '/',
                                ) as any;
                                const notFoundEntry = match.handler;
                                if (!notFoundEntry) {
                                    throw new Error(
                                        'No not-found page configured',
                                    );
                                }
                                const {
                                    rendered,
                                    documentMeta,
                                    documentAssets,
                                    loaderData,
                                } = await render({
                                    toRender: 'not-found',
                                    entry: notFoundEntry as RoutePageHandler,
                                    routeParams: {},
                                    searchParams: {},
                                    req: req,
                                    pageOptions: {},
                                    cspNonce,
                                });
                                assets.push(...documentAssets);
                                clientHydrationScript = `
                                <script type="module" ${cspNonce ? `nonce="${cspNonce}"` : ''}>
                                import main from '${clientManifest!.inputs[clientManifest!.handler].output.path}';
                                main('/not-found/',${JSON.stringify(params)},${JSON.stringify(searchParams)}, ${JSON.stringify(loaderData)});
                                </script>
                            `;
                                html = rendered;
                                meta = {
                                    ...meta,
                                    ...documentMeta,
                                };
                                setResponseStatus(404);
                            } catch (e) {
                                console.error('404 module not found:', e);
                                setResponseStatus(404);
                                push('Not Found');
                                controller.close();
                                return;
                            }
                        } else {
                            const { options } = (matched as RoutePageHandler)
                                .mainPage.options
                                ? await getCachedModule<{ options: any }>(
                                      (matched as RoutePageHandler).mainPage
                                          .options as Import,
                                  )
                                : { options: {} };
                            if (options?.responseHeaders) {
                                const headers =
                                    options.responseHeaders as Record<
                                        string,
                                        string
                                    >;
                                for (const [key, value] of Object.entries(
                                    headers,
                                )) {
                                    setHeader(key, value);
                                }
                            }

                            // Deferred route: stream the shell immediately and
                            // stream deferred loader data in afterwards via Solid's
                            // renderToStream + Suspense. Non-deferred routes fall
                            // through to the unchanged renderToString path below.
                            if (
                                await hasDeferredLoaders(
                                    matched as RoutePageHandler,
                                )
                            ) {
                                const result = (await render({
                                    toRender: 'main',
                                    entry: matched as RoutePageHandler,
                                    routeParams: params,
                                    searchParams,
                                    req,
                                    pageOptions: options,
                                    cspNonce,
                                })) as any;
                                const assetsHtml = (
                                    result.documentAssets as any[]
                                )
                                    .map((asset) => {
                                        const attributeString = Object.entries(
                                            asset.attrs,
                                        )
                                            .map(
                                                ([key, value]) =>
                                                    `${key}="${value}"`,
                                            )
                                            .join(' ');
                                        if (asset.tag === 'script') {
                                            return `<script ${attributeString} ${cspNonce ? `nonce="${cspNonce}"` : ''}></script>`;
                                        }
                                        if (asset.tag === 'link') {
                                            return `<link ${attributeString}>`;
                                        }
                                        if (asset.tag === 'style') {
                                            return `<style ${attributeString}>${asset.children || ''}</style>`;
                                        }
                                        return '';
                                    })
                                    .join('\n');
                                const headHtml = `${generateHtmlHead({
                                    ...meta,
                                    ...result.documentMeta,
                                })}\n${assetsHtml}\n${hydrationScript({ nonce: cspNonce })}`;
                                const entryPath =
                                    clientManifest!.inputs[
                                        clientManifest!.handler
                                    ].output.path;
                                const mainScript = `<script type="module" ${cspNonce ? `nonce="${cspNonce}"` : ''}>import main from '${entryPath}';main('${(matched as RoutePageHandler).mainPage.manifestPath}',${JSON.stringify(params)},${JSON.stringify(searchParams)},${JSON.stringify(result.loaderData)},${JSON.stringify(result.deferredKeys)});</script>`;
                                setResponseStatus(200);
                                push(
                                    `<!doctype html><html lang="en"><head>${headHtml}</head>`,
                                );
                                await new Promise<void>((resolve) => {
                                    // The runtime `pipe(writable)` calls
                                    // `writable.write()` for chunks and
                                    // `writable.end()` on completion, and the
                                    // options accept `onError` — both wider than
                                    // the published types, hence the casts.
                                    const { pipe } = renderToStream(
                                        () => result.composed(),
                                        {
                                            nonce: cspNonce,
                                            onError(e: any) {
                                                streamError = e;
                                                if (import.meta.env.DEV) {
                                                    console.error(e);
                                                }
                                            },
                                        } as any,
                                    );
                                    pipe({
                                        write: (v: string) => push(v),
                                        end: () => {
                                            push(manifestHtml);
                                            push(mainScript);
                                            push('</html>');
                                            resolve();
                                        },
                                    } as any);
                                });
                                controller.close();
                                return;
                            }
                            try {
                                if (
                                    !(matched as RoutePageHandler).loadingPage
                                ) {
                                    throw new Error('No loading page');
                                }
                                const {
                                    rendered,
                                    documentMeta,
                                    documentAssets,
                                    loaderData,
                                } = await render({
                                    toRender: 'loading',
                                    entry: matched as RoutePageHandler,
                                    routeParams: params,
                                    searchParams,
                                    req: req,
                                    pageOptions: options,
                                    cspNonce,
                                });
                                const assetsHtml = assets
                                    .concat(documentAssets)
                                    .map((asset) => {
                                        const attributeString = Object.entries(
                                            asset.attrs,
                                        )
                                            .map(
                                                ([key, value]) =>
                                                    `${key}="${value}"`,
                                            )
                                            .join(' ');
                                        if (asset.tag === 'script') {
                                            return `<script ${attributeString}></script>`;
                                        }
                                        if (asset.tag === 'link') {
                                            return `<link ${attributeString}>`;
                                        }
                                        if (asset.tag === 'style') {
                                            return `<style ${attributeString}>${asset.children || ''}</style>`;
                                        }
                                    })
                                    .join('\n');
                                const html = `
                                <!doctype html>
                                <html lang="en">
                                    <head>
                                        ${generateHtmlHead({
                                            ...meta,
                                            ...documentMeta,
                                        })}
                                        ${assetsHtml}
                                        ${hydrationScript({ nonce: cspNonce })}
                                    </head>
                                    <noscript>
                                        Please enable JavaScript to view the content.<br/>
                                    </noscript>
                                    ${rendered}
                                </html>
                                `;
                                push(html);
                                push(`
                            <script type="module" data-hydration="loading" ${cspNonce ? `nonce="${cspNonce}"` : ''}>
                                import main from '${clientManifest!.inputs[clientManifest!.handler].output.path}';
                                main('${(matched as RoutePageHandler).loadingPage?.manifestPath}',${JSON.stringify(params)},${JSON.stringify(searchParams)}, ${JSON.stringify(loaderData)});
                            </script>
                            `);
                                loading = true;
                            } catch (e) {
                                // skip
                            }

                            const {
                                rendered,
                                documentMeta,
                                documentAssets,
                                loaderData,
                            } = await render({
                                toRender: 'main',
                                entry: matched as RoutePageHandler,
                                routeParams: params,
                                searchParams,
                                req: req,
                                pageOptions: options,
                                cspNonce,
                            });
                            assets.push(...documentAssets);
                            clientHydrationScript = `
                            <script type="module" ${cspNonce ? `nonce="${cspNonce}"` : ''}>
                            import main from '${clientManifest!.inputs[clientManifest!.handler].output.path}';
                            main('${(matched as RoutePageHandler).mainPage.manifestPath}',${JSON.stringify(params)},${JSON.stringify(searchParams)}, ${JSON.stringify(loaderData)});
                            </script>
                        `;
                            html = rendered;
                            meta = {
                                ...meta,
                                ...documentMeta,
                            };
                            setResponseStatus(200);
                        }
                    } catch (e1: any) {
                        streamError = e1;
                        if (
                            e1 instanceof RedirectError ||
                            e1.name === 'RedirectError'
                        ) {
                            setHeader('Location', e1.message);
                            setResponseStatus(302);
                            controller.close();
                            return;
                        }
                        if (import.meta.env.DEV) {
                            console.error(e1);
                        }
                        try {
                            const errorPage = (matched as RoutePageHandler)
                                .errorPage;
                            if (!errorPage) {
                                throw e1;
                            }
                            const {
                                rendered,
                                documentMeta,
                                documentAssets,
                                loaderData,
                            } = await render({
                                toRender: 'error',
                                entry: matched as RoutePageHandler,
                                routeParams: params,
                                searchParams,
                                req: req,
                                pageOptions: {},
                                cspNonce,
                                error: e1,
                            });
                            assets.push(...documentAssets);
                            clientHydrationScript = `
                            <script type="module" ${cspNonce ? `nonce="${cspNonce}"` : ''}>
                            import main from '${clientManifest!.inputs[clientManifest!.handler].output.path}';
                            main('${errorPage.manifestPath}',${JSON.stringify(params)},${JSON.stringify(searchParams)}, ${JSON.stringify(loaderData)});
                            </script>
                        `;
                            html = rendered;
                            meta = {
                                ...meta,
                                ...documentMeta,
                            };
                            // statusCode = 500;
                            setResponseStatus(500);
                        } catch (e2) {
                            throw e1;
                        }
                    }

                    if (loading) {
                        const assetsHtml = assets
                            .map((asset) => {
                                const attributeString = Object.entries(
                                    asset.attrs,
                                )
                                    .map(([key, value]) => `${key}="${value}"`)
                                    .join(' ');
                                if (asset.tag === 'link') {
                                    return `<link ${attributeString}>`;
                                }
                                if (asset.tag === 'style') {
                                    return `<style ${attributeString}>${asset.children || ''}</style>`;
                                }
                                return '';
                            })
                            .join('\n');
                        push(`<template id="__page_html__">${html}</template>`);
                        push(`
                        <script ${cspNonce ? `nonce="${cspNonce}"` : ''}>
                        const head = document.querySelector('head');
                        const scripts = Array.from(head.querySelectorAll('script'));
                        head.innerHTML = ${JSON.stringify(generateHtmlHead(meta) + assetsHtml)};
                        scripts.forEach(script => {
                            head.appendChild(script);
                        });
                        document.querySelector('script[data-hydration="loading"]')?.remove();
                        const loading = document.querySelector('body');
                        const template = document.getElementById('__page_html__');
                        loading.innerHTML = template.innerHTML;
                        template.remove();
                        </script>
                    `);
                        push(manifestHtml);
                        push(clientHydrationScript);
                        controller.close();
                        return;
                    }
                    const assetsHtml = assets
                        .map((asset) => {
                            const attributeString = Object.entries(asset.attrs)
                                .map(([key, value]) => `${key}="${value}"`)
                                .join(' ');
                            if (asset.tag === 'script') {
                                return `<script ${attributeString} ${cspNonce ? `nonce="${cspNonce}"` : ''}></script>`;
                            }
                            if (asset.tag === 'link') {
                                return `<link ${attributeString}>`;
                            }
                            if (asset.tag === 'style') {
                                return `<style ${attributeString}>${asset.children || ''}</style>`;
                            }
                        })
                        .join('\n');
                    const transformHtml = template
                        .replace(
                            '<!--app-head-->',
                            `${generateHtmlHead(meta)}\n${assetsHtml}\n${hydrationScript({ nonce: cspNonce })}`,
                        )
                        .replace(
                            '<!--app-body-->',
                            (html ?? '') + manifestHtml + clientHydrationScript,
                        );
                    push(transformHtml);
                    controller.close();
                    return;
                } catch (error) {
                    streamError = streamError ?? error;
                    throw error;
                } finally {
                    const statusCode = getResponseStatus(event) || 200;
                    const respCtx = createResponseContext(reqCtx, statusCode);
                    await safeExecuteHook(
                        'onResponseEnd',
                        inst?.onResponseEnd,
                        req,
                        respCtx,
                    );
                    if (streamError) {
                        await safeExecuteHook(
                            'onRequestError',
                            inst?.onRequestError as any,
                            streamError,
                            req,
                            reqCtx,
                        );
                    }
                }
            },
        });
        return stream;
    } catch (e: any) {
        if (e instanceof RedirectError || e.name === 'RedirectError') {
            return new Response('', {
                status: 302,
                headers: { Location: e.message },
            });
        }
        console.error(e);
        return new Response('Internal Server Error', { status: 500 });
    }
});

export default handler;
