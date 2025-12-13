import { eventHandler, toWebRequest, setHeader, setResponseStatus } from 'vinxi/http';
import { getManifest } from 'vinxi/manifest';
import { generateHydrationScript, renderToString } from 'solid-js/web';
import type { Meta } from './utils/meta';
import fileRoutes, { type RouteModule } from 'vinxi/routes';
import { RedirectError } from './utils/redirect';
import { setCache, getCache } from './utils/cache';
import { handleServerFunction } from './utils/server-action.server';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

type Import = {
    src: string;
    import: any;
};

type RoutePageEntry = {
    type: 'page';
    mainPage: {
        manifestPath: string;
        page: Import;
        loader?: Import;
        generateMeta?: Import;
        options?: Import;
    };
    loadingPage?: {
        manifestPath: string;
        page: Import;
        generateMeta?: Import;
    };
    errorPage?: {
        manifestPath: string;
        page: Import;
        generateMeta?: Import;
    };
    notFoundPage?: {
        manifestPath: string;
        page: Import;
        generateMeta?: Import;
    };
    layouts: {
        manifestPath: string;
        layout: Import;
        loader?: Import;
        generateMeta?: Import;
    }[];
    groups?: {
        [key: string]: {
            manifestPath: string;
            page: Import;
            loader?: Import;
        };
    };
};

type RouteEntry = (
    | {
        type: 'route';
        handler: Import;
        manifestPath: string;
    }
    | RoutePageEntry
) & {
    regex: RegExp;
    paramKeys: string[];
};

type RouteManifest = {
    [key: string]: RouteEntry;
};

type FileRoute = RouteModule & {
    type: 'route' | 'loading' | 'error' | 'not-found' | 'layout' | 'group';
    $component: Import;
    $loader?: Import;
    $generateMeta?: Import;
    $handler?: Import;
    $options?: Import;
    parent?: string; // for groups
};

const isPageFile = (file: string) =>
    file.endsWith('page.tsx') ||
    file.endsWith('page.jsx') ||
    file.endsWith('page.ts') ||
    file.endsWith('page.js');

const isRouteFile = (file: string) =>
    file.endsWith('route.ts') || file.endsWith('route.js');

const parseSegment = (part: string) => {
    if (part.startsWith('[[') && part.endsWith(']]')) {
        return `:^*${part.slice(5, -2)}`;
    }
    return part.startsWith('[')
        ? `:${part.slice(1, -1).replace(/\.\.\./, '*')}`
        : part;
};

const createMatcher = (routePath: string) => {
    const keys: string[] = [];
    const segments = routePath.split('/').map((part) => {
        if (part.startsWith(':')) {
            if (part.startsWith(':^*')) {
                // Catch-all inclusive
                keys.push(part.slice(3));
                return '?(.*)?';
            }
            if (part.startsWith(':*')) {
                // Catch-all
                keys.push(part.slice(2));
                return '.*';
            }
            // Standard param
            keys.push(part.slice(1));
            return '([^/]+)';
        }
        return part;
    });

    return {
        regex: new RegExp(`^${segments.join('/')}$`),
        keys,
    };
};

const getNormalizedPath = (path: string, clean?: boolean) => {
    const segments = path.split('/').slice(2).map(parseSegment);
    if (clean)
        return `/${segments.filter((s) => !s.startsWith('(')).join('/')}`;

    return `/${segments.join('/')}`;
};

const createRouteManifest = async () => {
    const entries: RouteManifest = {};

    const allRoutes: FileRoute[] = [];
    const layoutsMap = new Map<string, FileRoute>();
    const loadingPagesMap = new Map<string, FileRoute>();
    const errorPagesMap = new Map<string, FileRoute>();
    const groupsMap = new Map<string, FileRoute[]>();
    let notFoundPage: FileRoute | undefined;

    for (const fileRoute of fileRoutes as FileRoute[]) {
        if (fileRoute.type === 'route') {
            allRoutes.push(fileRoute);
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
            const parentPath = fileRoute.parent
                ? getNormalizedPath(fileRoute.parent)
                : '';
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

            const groups: RoutePageEntry['groups'] = {};
            if (matchedGroups && matchedGroups.length > 0) {
                for (const group of matchedGroups) {
                    const groupName = group.path
                        .split('/')
                        .filter((s) => !s.startsWith('('))
                        .map(parseSegment)
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
            const layouts: RoutePageEntry['layouts'] = [];

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

            const { regex: matcherRegex, keys } = createMatcher(routePath);

            entries[routePath] = {
                type: 'page',
                regex: matcherRegex,
                paramKeys: keys,
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
        } else if (src && isRouteFile(src)) {
            const { regex: matcherRegex, keys } = createMatcher(routePath);
            entries[routePath] = {
                type: 'route',
                regex: matcherRegex,
                paramKeys: keys,
                handler: fileRoute.$handler as Import,
                manifestPath: fileRoute.path,
            };
        }
    }

    return entries;
};

const extractRouteParams = (route: string, url: string) => {
    const routeSegments = route.split('/').filter(s => !(s.startsWith('('))).filter(Boolean);
    const urlSegments = url.split('/').filter(Boolean);

    const params: Record<string, string | string[]> = {};
    let matched = true;

    for (let i = 0; i < routeSegments.length; i++) {
        const routeSeg = routeSegments[i];
        const urlSeg = urlSegments[i];
        const isDynamic = routeSeg.startsWith('[') && routeSeg.endsWith(']');
        if (isDynamic) {
            if (routeSeg.includes('...')) {
                // Catch-all parameter
                const isCatchAll = routeSeg.startsWith('[[') && routeSeg.endsWith(']]');
                const paramName = routeSeg.slice(isCatchAll ? 5 : 4, isCatchAll ? -2 : -1);
                params[paramName] = urlSegments.slice(i);
                break; // No more segments to match
            }
            const paramName = routeSeg.slice(1, -1);
            params[paramName] = urlSeg;
        } else if (routeSeg !== urlSeg) {
            matched = false;
            break;
        }
    }

    if (matched) return { route, params };
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
    error
}: {
    toRender: 'main' | 'loading' | 'error' | 'not-found';
    entry: RoutePageEntry;
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
    const compose = entry.layouts.reduceRight(
        (children, layout, index) => async () => {
            const moduleSrc = `${layout.layout.src}&pick=$css`;
            const moduleAssets =
                await clientManifest.inputs[moduleSrc].assets();
            assets.push(...moduleAssets);
            const { default: layoutModule } = await layout.layout.import();
            const { loader: layoutLoader } = layout.loader
                ? await layout.loader.import()
                : { loader: null };
            const { generateMeta: generateMetaPage } = layout.generateMeta
                ? await layout.generateMeta.import()
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
            if (layoutLoader) {
                const result = await layoutLoader.loader(req);
                data = result.data || {};
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
                                await group.page.import();
                            const { loader: groupLoader } = group.loader
                                ? await group.loader.import()
                                : { loader: null };
                            let data = {};
                            if (groupLoader) {
                                const result = await groupLoader.loader(req);
                                data = result.data || {};
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
            const pageToRender: any =
                toRender === 'loading'
                    ? entry.loadingPage
                    : toRender === 'error'
                        ? entry.errorPage
                        : toRender === 'not-found'
                            ? entry.notFoundPage
                            : entry.mainPage;
            const moduleSrc = `${pageToRender.page.src}&pick=$css`;
            const moduleAssets =
                await clientManifest.inputs[moduleSrc].assets();
            assets.push(...moduleAssets);
            const { default: page } = await pageToRender.page.import();
            const { loader: pageLoader } = pageToRender.loader
                ? await pageToRender.loader.import()
                : { loader: null };
            const { generateMeta } = pageToRender.generateMeta
                ? await pageToRender.generateMeta.import()
                : { generateMeta: null };

            let data = {};
            if (pageLoader) {
                const result = await pageLoader.loader(req);
                data = result.data || {};
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
            return () =>
                page(props);
        },
    );

    const composed = await compose();
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

let routeManifest: RouteManifest = {};

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
        routeManifest = await createRouteManifest();
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
};

onStart();

const handler = eventHandler(async (event) => {
    const req = toWebRequest(event);

    try {
        if (req.url?.includes('_server')) {
            return handleServerFunction(event);
        }

        const clientManifest = getManifest('client');

        if (!routeManifest || Object.keys(routeManifest).length === 0) {
            routeManifest = await createRouteManifest();
        }

        const cspNonce = (event as any).locals?.cspNonce as string | undefined;

        const url = new URL(req.url).pathname;
        // extract route params and search params
        let params: Record<string, string | string[]> = {};
        const searchParams: Record<string, string> = {};
        const [pathnamePart, searchParamPart] = url.split('?');
        if (searchParamPart) {
            for (const param of searchParamPart.split('&')) {
                const [key, value] = param.split('=');
                searchParams[key] = decodeURIComponent(value || '');
            }
        }

        let matched: RouteEntry | undefined;

        for (const entry of Object.values(routeManifest)) {
            const match = entry.regex.exec(pathnamePart);
            if (match) {
                matched = entry;
                if (entry.paramKeys) {
                    const routePath = matched && matched.type === 'route'
                        ? matched.manifestPath.split('/').slice(2).join('/')
                        : matched && matched.type === 'page'
                            ? (matched as RoutePageEntry).mainPage.manifestPath.split('/').slice(2).join('/')
                            : '/';
                    params = extractRouteParams(routePath, pathnamePart)?.params || {};
                }
                break;
            }
        }

        if (matched && matched.type === 'route') {
            const routeModule = await matched.handler.import();
            const reqMethod = req.method?.toUpperCase();
            if (reqMethod) {
                const handler = routeModule[reqMethod];
                if (typeof handler === 'function') {
                    const result = await handler(req, {
                        params: params,
                        searchParams: searchParams,
                    });
                    return result;
                }

                throw new Error(
                    `Method ${reqMethod} not implemented in ${matched.handler.src}`,
                );
            }
            throw new Error(`Unsupported request method: ${reqMethod}`);
        }
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

                try {
                    if (!matched) {
                        try {
                            const notFoundPage = routeManifest[
                                '/'
                            ] as RoutePageEntry;
                            const {
                                rendered,
                                documentMeta,
                                documentAssets,
                                loaderData,
                            } = await render({
                                toRender: 'not-found',
                                entry: notFoundPage,
                                routeParams: {},
                                searchParams: {},
                                req: req,
                                pageOptions: {},
                                cspNonce,
                            });
                            assets.push(...documentAssets);
                            clientHydrationScript = `
                                <script type="module" ${cspNonce ? `nonce="${cspNonce}"` : ''}>
                                import main from '${clientManifest.inputs[clientManifest.handler].output.path}';
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
                        const { options } = (matched as RoutePageEntry).mainPage.options
                            ? await ((matched as RoutePageEntry).mainPage.options as any).import()
                            : { options: {} };
                        if (options?.responseHeaders) {
                            const headers = options.responseHeaders as Record<string, string>;
                            for (const [key, value] of Object.entries(headers)) {
                                setHeader(key, value);
                            }
                        }
                        try {
                            if (!(matched as RoutePageEntry).loadingPage) {
                                throw new Error('No loading page');
                            }
                            const {
                                rendered,
                                documentMeta,
                                documentAssets,
                                loaderData,
                            } = await render({
                                toRender: 'loading',
                                entry: matched as RoutePageEntry,
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
                                import main from '${clientManifest.inputs[clientManifest.handler].output.path}';
                                main('${(matched as RoutePageEntry).loadingPage?.manifestPath}',${JSON.stringify(params)},${JSON.stringify(searchParams)}, ${JSON.stringify(loaderData)});
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
                            entry: matched as RoutePageEntry,
                            routeParams: params,
                            searchParams,
                            req: req,
                            pageOptions: options,
                            cspNonce,
                        });
                        assets.push(...documentAssets);
                        clientHydrationScript = `
                            <script type="module" ${cspNonce ? `nonce="${cspNonce}"` : ''}>
                            import main from '${clientManifest.inputs[clientManifest.handler].output.path}';
                            main('${(matched as RoutePageEntry).mainPage.manifestPath}',${JSON.stringify(params)},${JSON.stringify(searchParams)}, ${JSON.stringify(loaderData)});
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
                        const errorPage = (matched as RoutePageEntry).errorPage;
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
                            entry: matched as RoutePageEntry,
                            routeParams: params,
                            searchParams,
                            req: req,
                            pageOptions: {},
                            cspNonce,
                            error: e1
                        });
                        assets.push(...documentAssets);
                        clientHydrationScript = `
                            <script type="module" ${cspNonce ? `nonce="${cspNonce}"` : ''}>
                            import main from '${clientManifest.inputs[clientManifest.handler].output.path}';
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
                            const attributeString = Object.entries(asset.attrs)
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
                    push(`
                        <script ${cspNonce ? `nonce="${cspNonce}"` : ''}>
                        const head = document.querySelector('head');
                        const scripts = Array.from(head.querySelectorAll('script'));
                        head.innerHTML = \`${generateHtmlHead(meta) + assetsHtml}\`;
                        scripts.forEach(script => {
                            head.appendChild(script);
                        });
                        document.querySelector('script[data-hydration="loading"]')?.remove();
                        const loading = document.querySelector('body');
                        loading.innerHTML = \`${html}\`;
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
            },
        });
        return stream;
    } catch (e: any) {
        console.error(e);
        return new Response('Internal Server Error', { status: 500 });
    }
});

export default handler;
