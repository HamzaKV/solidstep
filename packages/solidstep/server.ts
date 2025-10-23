import { eventHandler, toWebRequest } from 'vinxi/http';
import { getManifest } from 'vinxi/manifest';
import { generateHydrationScript, renderToString } from 'solid-js/web';
import type { Meta } from './utils/meta';
import type { ServerResponse, IncomingMessage } from 'node:http';
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
        }
    };
};

type RouteEntry = {
    type: 'route';
    handler: Import;
    manifestPath: string;
} | RoutePageEntry;

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
    file.endsWith('page.tsx')
    || file.endsWith('page.jsx')
    || file.endsWith('page.ts')
    || file.endsWith('page.js');

const isRouteFile = (file: string) =>
    file.endsWith('route.ts') || file.endsWith('route.js');

const parseSegment = (part: string) =>
    part.startsWith('[') ? `:${part.slice(1, -1).replace(/\.\.\./, '*')}` : part;

const createRouteManifest = async () => {
    const entries: RouteManifest = {};

    const allRoutes: FileRoute[] = [];
    const allLayouts: FileRoute[] = [];
    const allLoadingPages: FileRoute[] = [];
    const allErrorPages: FileRoute[] = [];
    const allGroups: FileRoute[] = [];
    let notFoundPage: FileRoute | undefined;

    for (const fileRoute of (fileRoutes as FileRoute[])) {
        if (fileRoute.type === 'route') {
            allRoutes.push(fileRoute);
        }

        if (fileRoute.type === 'layout') {
            allLayouts.push(fileRoute);
        }

        if (fileRoute.type === 'not-found') {
            notFoundPage = fileRoute;
        }

        if (fileRoute.type === 'loading') {
            allLoadingPages.push(fileRoute);
        }

        if (fileRoute.type === 'error') {
            allErrorPages.push(fileRoute);
        }

        if (fileRoute.type === 'group') {
            allGroups.push(fileRoute);
        }
    }

    for (const fileRoute of allRoutes) {
        const segments = fileRoute.path.split('/').slice(2).map(parseSegment);
        const routePath = `/${segments.filter(s => !(s.startsWith('('))).join('/')}`;
        const regex = /\?(?:pick=.*)*/g;
        const src = fileRoute.$handler?.src.replace(regex, '');
        
        if (src && isPageFile(src)) {
            const loadingPage = allLoadingPages.find(route => {
                const path = `/${route.path.split('/').slice(2).map(parseSegment).join('/')}`;
                return path === routePath;
            });

            const matchedGroups = allGroups.filter(route => {
                const parentPath = route.parent ? `/${route.parent.split('/').slice(2).map(parseSegment).join('/')}` : '';
                return parentPath === routePath;
            });
            const groups: RoutePageEntry['groups'] = {};
            if (matchedGroups && matchedGroups.length > 0) {
                for (const group of matchedGroups) {
                    const groupName = group.path.split('/').filter(s => !(s.startsWith('('))).map(parseSegment).at(-1);
                    if (!groupName) continue;
                    groups[groupName] = {
                        manifestPath: group.path,
                        page: group.$component,
                        loader: group.$loader,
                    };
                }
            }

            let errorPage: FileRoute | undefined;
            const layouts: RoutePageEntry['layouts'] = [];
            for (let i = segments.length; i > (routePath === '/' ? 0 : -1); i--) {
                const path = `/${segments.slice(0, i).join('/')}`;
                if (!errorPage) {
                    errorPage = allErrorPages.find(route => {
                        const routePath = `/${route.path.split('/').slice(2).map(parseSegment).join('/')}`;
                        return routePath === path;
                    });
                }
                const layout = allLayouts.find(route => {
                    const routePath = `/${route.path.split('/').slice(2).map(parseSegment).join('/')}`;
                    return routePath === path;
                });
                if (layout) {
                    layouts.unshift({
                        manifestPath: layout.path,
                        layout: layout.$component,
                        loader: layout.$loader,
                        generateMeta: layout.$generateMeta,
                    });
                }
            }

            entries[routePath] = {
                type: 'page',
                mainPage: {
                    manifestPath: fileRoute.path,
                    page: fileRoute.$component,
                    loader: fileRoute.$loader,
                    generateMeta: fileRoute.$generateMeta,
                    options: fileRoute.$options,
                },
                loadingPage: loadingPage ? {
                    page: loadingPage.$component,
                    generateMeta: loadingPage.$generateMeta,
                    manifestPath: loadingPage.path,
                } : undefined,
                errorPage: errorPage ? {
                    page: errorPage.$component,
                    generateMeta: errorPage.$generateMeta,
                    manifestPath: errorPage.path,
                } : undefined,
                notFoundPage: routePath === '/' && notFoundPage ? {
                    page: notFoundPage.$component,
                    generateMeta: notFoundPage.$generateMeta,
                    manifestPath: notFoundPage.path,
                } : undefined,
                layouts: layouts,
                groups: groups,
            };
        } else if (src && isRouteFile(src)) {
            entries[routePath] = {
                type: 'route',
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

    const params: any = {};
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
            
            if (value.type === 'link' || value.type === 'style' || value.type === 'script') {
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

const sendNodeResponse = async (
    res: ServerResponse & { req: IncomingMessage },
    response: Response
) => {
    // Set status code
    res.statusCode = response.status;

    // Set headers
    response.headers.forEach((value, key) => {
        res.setHeader(key, value);
    });

    // Stream the body
    if (response.body) {
        const reader = response.body.getReader();

        const push = async () => {
            const { done, value } = await reader.read();
            if (done) {
                res.end();
                return;
            }
            res.write(Buffer.from(value));
            await push();
        };

        await push();
    } else {
        const text = await response.text()
        res.end(text)
    }
};

const render = async ({
    toRender,
    entry,
    routeParams,
    searchParams,
    req,
    cspNonce,
}: {
    toRender: 'main' | 'loading' | 'error' | 'not-found',
    entry: RoutePageEntry,
    routeParams: Record<string, string>,
    searchParams: Record<string, string>,
    req: Request,
    cspNonce?: string,
}) => {
    const url = req.url || '/';
    const cachedEntry = getCache<{
        rendered: string;
        documentMeta: Meta;
        documentAssets: any[];
        loaderData: Record<string, any>;
    }>(url);

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
    let cachingOptions: CacheOptions | undefined = undefined;
    let meta: Meta = {};
    const loaderData: Record<string, any> = {};
    const clientManifest = getManifest('client');
    const assets: any[] = [];
    const compose = entry.layouts.reduceRight(
        (children, layout, index) => async () => {
            const moduleSrc = `${layout.layout.src}&pick=$css`;
            const moduleAssets = await clientManifest.inputs[moduleSrc].assets();
            for (const asset of moduleAssets) {
                assets.push(asset);
            }
            const { default: layoutModule } = await layout.layout.import();
            const { loader: layoutLoader } = layout.loader ? await layout.loader.import() : { loader: null };
            const { generateMeta: generateMetaPage } = layout.generateMeta ? await layout.generateMeta.import() : { generateMeta: null };
            let data = {};
            if (generateMetaPage) {
                const metaData = await generateMetaPage({
                    req,
                    cspNonce,
                });
                if (metaData) {
                    meta = {
                        ...meta,
                        ...metaData
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
                            const moduleAssets = await clientManifest.inputs[moduleSrc].assets();
                            for (const asset of moduleAssets) {
                                assets.push(asset);
                            }
                            const { default: groupPage } = await group.page.import();
                            const { loader: groupLoader } = group.loader ? await group.loader.import() : { loader: null };
                            let data = {};
                            if (groupLoader) {
                                const result = await groupLoader.loader(req);
                                data = result.data || {};
                                loaderData[group.manifestPath] = data;
                            }
                            slots[groupName.replace('@', '')] = () => groupPage({
                                routeParams,
                                searchParams,
                                loaderData: data
                            });
                        })()
                    );
                }
            }
            const [childrenRendered] = await Promise.all(slotPromises);
            return () => layoutModule({
                children: childrenRendered,
                routeParams,
                searchParams,
                loaderData: data,
                slots: slots,
                locals: {
                    cspNonce: cspNonce,
                }
            });
        },
        async () => {
            const pageToRender: any = toRender === 'loading'
                ? entry.loadingPage
                : toRender === 'error'
                    ? entry.errorPage
                    : toRender === 'not-found'
                        ? entry.notFoundPage
                        : entry.mainPage;
            const moduleSrc = `${pageToRender.page.src}&pick=$css`;
            const moduleAssets = await clientManifest.inputs[moduleSrc].assets();
            for (const asset of moduleAssets) {
                assets.push(asset);
            }
            const { default: page } = await pageToRender.page.import();
            const { loader: pageLoader } = pageToRender.loader ? await pageToRender.loader.import() : { loader: null };
            const { generateMeta } = pageToRender.generateMeta ? await pageToRender.generateMeta.import() : { generateMeta: null };
            const { options } = pageToRender.options ? await pageToRender.options.import() : { options: {} };
            if (options?.cache) {
                cachingOptions = options.cache as CacheOptions;
            }
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
                        ...metaData
                    };
                }
            }
            return () => page({
                routeParams,
                searchParams,
                loaderData: data,
                locals: {
                    cspNonce: cspNonce,
                }
            });
        }
    );

    const composed = await compose();
    const rendered = await renderToString(() => composed());

    if (cachingOptions && toRender === 'main') {
        setCache(url, {
            rendered: rendered,
            documentMeta: meta,
            documentAssets: assets,
            loaderData: loaderData,
        }, ((cachingOptions as CacheOptions)).ttl);
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
    return nonce ? script.replace('<script', `<script nonce="${nonce}"`) : script;
};

const onStart = async () => {
    try {
        routeManifest = await createRouteManifest();
        const sharedConfig = (globalThis as any).__SOLIDSTEP_CONFIG__;
        if (!sharedConfig) {
            const __dirname = dirname(fileURLToPath(import.meta.url));
            const configContent = await readFile(`${__dirname}/.config.json`, 'utf-8');
            // @ts-ignore
            globalThis.__SOLIDSTEP_CONFIG__ = JSON.parse(configContent);
        }
    } catch (e) {
        console.error('Error creating route manifest:', e);
    }
};

onStart();

const handler = eventHandler(async (event) => {
    const req = event.node.req;
    const res = event.node.res;

    try {
        if (req.url?.includes('_server')) {
            return handleServerFunction(event);
        }

        const clientManifest = getManifest('client');

        if (!routeManifest || Object.keys(routeManifest).length === 0) {
            routeManifest = await createRouteManifest();
        }

        const cspNonce = (event as any).locals?.cspNonce as string | undefined;

        const url = req.url || '/';
        // extract route params and search params
        const params: Record<string, string> = {};
        const searchParams: Record<string, string> = {};
        const [pathnamePart, searchParamPart] = url.split('?');
        if (searchParamPart) {
            for (const param of searchParamPart.split('&')) {
                const [key, value] = param.split('=');
                searchParams[key] = decodeURIComponent(value || '');
            }
        }

        const matched = Object.entries(routeManifest).find(([path, entry]) => {
            const pattern = path
                .replace(/:\[\*[^/\]]+\]/g, '?(.*)?')  // [[...slug]] -> (.*)?
                .replace(/:\*[^/]*/g, '.*')           // :*slug or :* -> .*
                .replace(/:[^/]+/g, '[^/]+');        // :post -> [^/]+

            const re = new RegExp(`^${pattern}$`);
            return re.test(pathnamePart);
        })?.[1] as RouteEntry;

        const routePath = matched && matched.type === 'route'
            ? matched.manifestPath.split('/').slice(2).join('/')
            : matched && matched.type === 'page'
                ? (matched as RoutePageEntry).mainPage.manifestPath.split('/').slice(2).join('/')
                : '/';

        const routeParams = extractRouteParams(routePath, pathnamePart);
        if (routeParams) {
            Object.assign(params, routeParams.params);
        }

        if (matched && matched.type === 'route') {
            const routeModule = await matched.handler.import();
            const reqMethod = req.method?.toUpperCase();
            if (reqMethod) {
                const handler = routeModule[reqMethod];
                if (typeof handler === 'function') {
                    const result = await handler(toWebRequest(event), {
                        params: params,
                        searchParams: searchParams,
                    });
                    await sendNodeResponse(res, result);
                    return;
                } 
                
                throw new Error(`Method ${reqMethod} not implemented in ${matched.handler.src}`);
            } 
            throw new Error(`Unsupported request method: ${reqMethod}`);
        }
        let loading = false;
        let html: string | undefined = undefined;
        let meta: Meta = {
            charset: {
                type: 'meta',
                attributes: {
                    charset: 'UTF-8'
                }
            },
            viewport: {
                type: 'meta',
                attributes: {
                    name: 'viewport',
                    content: 'width=device-width, initial-scale=1.0'
                }
            },
            title: {
                type: 'title',
                attributes: {},
                content: 'SolidStep'
            }
        };
        const assets = await clientManifest.inputs[clientManifest.handler].assets();
        const manifestHtml = `<script ${cspNonce ? `nonce="${cspNonce}"` : ''}>window.manifest=${JSON.stringify(await clientManifest.json())}</script>`;

        let clientHydrationScript: string | undefined = undefined;

        res.setHeader('Content-Type', 'text/html');
        res.setHeader('Cache-Control', 'no-cache');
        try {
            if (!matched) {
                try {
                    const notFoundPage = routeManifest['/'] as RoutePageEntry;
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
                        req: toWebRequest(event),
                        cspNonce,
                    });
                    for (const asset of documentAssets) {
                        assets.push(asset);
                    }
                    clientHydrationScript = `
                        <script type="module" ${cspNonce ? `nonce="${cspNonce}"` : ''}>
                        import main from '${clientManifest.inputs[clientManifest.handler].output.path}';
                        main('/not-found/',${JSON.stringify(params)},${JSON.stringify(searchParams)}, ${JSON.stringify(loaderData)});
                        </script>
                    `;
                    html = rendered;
                    meta = {
                        ...meta,
                        ...documentMeta
                    };
                    res.statusCode = 404;
                } catch (e) {
                    console.error('404 module not found:', e);
                    res.statusCode = 404;
                    return res.end('Not Found');
                }
            } else {
                try {
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
                        req: toWebRequest(event),
                        cspNonce,
                    });
                    const assetsHtml = assets.concat(documentAssets).map((asset) => {
                        const attributeString = Object.entries(asset.attrs)
                            .map(([key, value]) => `${key}="${value}"`)
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
                    }).join('\n');
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
                    res.write(html);
                    res.write(`
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
                    req: toWebRequest(event),
                    cspNonce,
                });
                for (const asset of documentAssets) {
                    assets.push(asset);
                }
                clientHydrationScript = `
                    <script type="module" ${cspNonce ? `nonce="${cspNonce}"` : ''}>
                    import main from '${clientManifest.inputs[clientManifest.handler].output.path}';
                    main('${(matched as RoutePageEntry).mainPage.manifestPath}',${JSON.stringify(params)},${JSON.stringify(searchParams)}, ${JSON.stringify(loaderData)});
                    </script>
                `;
                html = rendered;
                meta = {
                    ...meta,
                    ...documentMeta
                };
            }
        } catch (e1) {
            if (e1 instanceof RedirectError) {
                throw e1;
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
                    req: toWebRequest(event),
                    cspNonce,
                });
                for (const asset of documentAssets) {
                    assets.push(asset);
                }
                clientHydrationScript = `
                    <script type="module" ${cspNonce ? `nonce="${cspNonce}"` : ''}>
                    import main from '${clientManifest.inputs[clientManifest.handler].output.path}';
                    main('${errorPage.manifestPath}',${JSON.stringify(params)},${JSON.stringify(searchParams)}, ${JSON.stringify(loaderData)});
                    </script>
                `;
                html = rendered;
                meta = {
                    ...meta,
                    ...documentMeta
                };
                res.statusCode = 500;
            } catch (e2) {
                throw e1;
            }
        }

        if (loading) {
            const assetsHtml = assets.map((asset) => {
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
            }).join('\n');
            res.write(`
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
            res.write(manifestHtml);
            return res.end(clientHydrationScript);
        } 
        const assetsHtml = assets.map((asset) => {
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
        }).join('\n');
        const transformHtml = template
            .replace('<!--app-head-->', `${generateHtmlHead(meta)}\n${assetsHtml}\n${hydrationScript({ nonce: cspNonce})}`)
            .replace('<!--app-body-->', (html ?? '') + manifestHtml + clientHydrationScript);
        return res.end(transformHtml);
    } catch (e) {
        if (e instanceof RedirectError) {
            res.statusCode = 302;
            res.setHeader('Location', e.message);
            return res.end('Redirecting...');
        }
        console.error(e);
        res.statusCode = 500;
        return res.end('Internal Server Error');
    }
});

export default handler;
