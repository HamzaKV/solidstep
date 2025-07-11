import { eventHandler } from 'vinxi/http';
import { getManifest } from 'vinxi/manifest';
import { generateHydrationScript, renderToString } from 'solid-js/web';
import { readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { Meta } from './utils/types';
import type { ServerResponse, IncomingMessage } from 'node:http';
import fileRoutes, { type RouteModule } from 'vinxi/routes';

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
} | RoutePageEntry;

type RouteManifest = {
    [key: string]: RouteEntry;
};

const isPageFile = (file: string) =>
    file.endsWith('page.tsx') 
    || file.endsWith('page.jsx') 
    || file.endsWith('page.ts') 
    || file.endsWith('page.js');

const isRouteFile = (file: string) =>
    file.endsWith('route.ts') || file.endsWith('route.js');

const parseSegment = (part: string) =>
    part.startsWith('[') ? ':' + part.slice(1, -1).replace(/\.\.\./, '*') : part;

const createRouteManifest = async (baseDir = 'app') => {
    const entries: RouteManifest = {};

    const walk = async (dir: string) => {
        const contents = await readdir(dir);
        for (const entry of contents) {
            const fullPath = join(dir, entry);
            if ((await stat(fullPath)).isDirectory()) {
                await walk(fullPath);
            } else if (isPageFile(fullPath)) {
                const rel = relative(baseDir, fullPath);
                const parts = rel.split(sep);
                const segments = parts.slice(0, -1); // drop 'page.tsx'

                if (segments.find(s => s.startsWith('@'))) {
                    // don't include parallel routes in the manifest
                    continue;
                }

                const urlSegments = segments
                    .filter(s => !(s.startsWith('('))) // drop route groups
                    .map(parseSegment);
                const routePath = '/' + urlSegments.join('/');
                const mainPage = fileRoutes.find(route => {
                    const path = '/' + route.path.split('/').slice(2).filter(s => !(s.startsWith('('))).map(parseSegment).join('/');
                    return (route as any).type === 'route' && path === routePath;
                });
                const loadingPage = fileRoutes.find(route => {
                    const path = '/' + route.path.split('/').slice(2).filter(s => !(s.startsWith('('))).map(parseSegment).join('/');
                    return (route as any).type === 'loading' && path === routePath;
                });
                let errorPage: RouteModule;
                const layouts: RoutePageEntry['layouts'] = [];
                const fileSegments = segments
                    .map(parseSegment);
                for (let i = 0; i < fileSegments.length + 1; i++) {
                    const route = '/' + fileSegments.slice(0, fileSegments.length-i).join('/');
                    
                    for (const fileRoute of fileRoutes) {
                        const path = '/' + fileRoute.path.split('/').slice(2).map(parseSegment).join('/');
                        if (!errorPage && (fileRoute as any).type === 'error' && path === route) {
                            errorPage = fileRoute;
                        }
                        if ((fileRoute as any).type === 'layout' && path === route) {
                            layouts.unshift({
                                layout: fileRoute.$component,
                                loader: fileRoute.$loader,
                                generateMeta: fileRoute.$generateMeta,
                                manifestPath: fileRoute.path,
                            });
                        }
                    }
                }
                let groups: RoutePageEntry['groups'] = {};
                for (const fileRoute of fileRoutes) {
                    const groupParentPath = (fileRoute as any).parent ? '/' + (fileRoute as any).parent.split('/').slice(2).filter(s => !(s.startsWith('('))).map(parseSegment).join('/') : '';
                    if ((fileRoute as any).type === 'group' && groupParentPath === routePath) {
                        const groupName = fileRoute.path.split('/').filter(s => !(s.startsWith('('))).map(parseSegment).at(-1);
                        groups[groupName] = {
                            page: fileRoute.$component,
                            loader: fileRoute.$loader,
                            manifestPath: fileRoute.path,
                        };
                    }
                }
                let notFoundPage: RouteModule | undefined;
                if (routePath === '/') {
                    notFoundPage = fileRoutes.find(route => {
                        const path = '/' + route.path.split('/').slice(2).join('/');
                        return (route as any).type === 'not-found' && path === routePath;
                    });
                }
                entries[routePath] = {
                    type: 'page',
                    mainPage: {
                        manifestPath: mainPage.path,
                        page: mainPage.$component,
                        loader: mainPage.$loader,
                        generateMeta: mainPage.$generateMeta,
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
                    layouts,
                    groups,
                    notFoundPage: notFoundPage ? {
                        page: notFoundPage.$component,
                        generateMeta: notFoundPage.$generateMeta,
                        manifestPath: notFoundPage.path,
                    } : undefined,
                };
            } else if (isRouteFile(fullPath)) {
                const rel = relative(baseDir, fullPath);
                const parts = rel.split(sep);
                const segments = parts.slice(0, -1); // drop 'route.ts'

                const urlSegments = segments
                    .filter(s => !(s.startsWith('('))) // drop route groups
                    .map(parseSegment);

                const routePath = '/' + urlSegments.join('/');
                const mainRoute = fileRoutes.find(route => {
                    const path = '/' + route.path.split('/').slice(2).filter(s => !(s.startsWith('('))).map(parseSegment).join('/');
                    return (route as any).type === 'route' && path === routePath;
                });

                entries[routePath] = {
                    type: 'route',
                    handler: mainRoute.$handler,
                };
            }
        }
    }
    await walk(baseDir);
    return entries;
};

const extractRouteParams = (route: string, url: string) => {
    const routeSegments = route.split('/').filter(Boolean);
    const urlSegments = url.split('/').filter(Boolean);

    if (routeSegments.length !== urlSegments.length) return null;

    const params = {};
    let matched = true;

    for (let i = 0; i < routeSegments.length; i++) {
        const routeSeg = routeSegments[i];
        const urlSeg = urlSegments[i];

        const isDynamic = routeSeg.startsWith('[') && routeSeg.endsWith(']');
        if (isDynamic) {
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
            } else if (value.type === 'meta') {
                const attrs = Object.entries(value.attributes)
                    .map(([attrKey, attrValue]) => `${attrKey}="${attrValue}"`)
                    .join(' ');
                return `<meta ${attrs}>`;
            } else if (value.type === 'link' || value.type === 'style' || value.type === 'script') {
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

const render = async (
    toRender: 'main' | 'loading' | 'error' | 'not-found',
    entry: RoutePageEntry,
    routeParams: Record<string, string>,
    searchParams: Record<string, string>,
    req: Request
) => {
    let meta: Meta = {};
    const compose = entry.layouts.reduceRight(
        (children, layout, index) => async () => {
            const { default: layoutModule } = await layout.layout.import();
            const { loader: layoutLoader } = layout.loader ? await layout.loader.import() : { loader: null };
            const { generateMeta: generateMetaPage } = layout.generateMeta ? await layout.generateMeta.import() : { generateMeta: null };
            let data = {};
            if (generateMetaPage) {
                const metaData = await generateMetaPage(req);
                if (metaData) {
                    meta = {
                        ...meta,
                        ...metaData
                    };
                }
            }
            if (layoutLoader) {
                const result = await layoutLoader(req);
                data = result.data || {};
            }
            let slots: Record<string, any> = {};
            if (index === entry.layouts.length - 1) {
                // last layout, we can render slots
                const groups = entry.groups || {};
                for (const [groupName, group] of Object.entries(groups)) {
                    const { default: groupPage } = await group.page.import();
                    const { loader: groupLoader } = group.loader ? await group.loader.import() : { loader: null };
                    let data = {};
                    if (groupLoader) {
                        const result = await groupLoader(req);
                        data = result.data || {};
                    }
                    slots[groupName.replace('@', '')] = () => groupPage({
                        routeParams,
                        searchParams,
                        loaderData: data
                    });
                }
            }
            const childrenRendered = await children();
            return () => layoutModule({
                children: childrenRendered,
                routeParams,
                searchParams,
                loaderData: data,
                slots: slots
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
            const { default: page } = await pageToRender.page.import();
            const { loader: pageLoader } = pageToRender.loader ? await pageToRender.loader.import() : { loader: null };
            const { generateMeta } = pageToRender.generateMeta ? await pageToRender.generateMeta.import() : { generateMeta: null };
            let data = {};
            if (pageLoader) {
                const result = await pageLoader(req);
                data = result.data || {};
            }
            if (generateMeta) {
                const metaData = await generateMeta(req);
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
                loaderData: data
            });
        }
    );

    const composed = await compose();
    const rendered = await renderToString(() => composed());
    return {
        rendered: rendered,
        documentMeta: meta
    };
};

let routeManifest: RouteManifest = {};

const handler = eventHandler(async (event) => {
    const clientManifest = getManifest('client');

    if (!routeManifest || Object.keys(routeManifest).length === 0) {
        routeManifest = await createRouteManifest();
    }

    const req = event.node.req;
    const res = event.node.res;

    try {
        const url = req.url || '/';
        // extract route params and search params
        const params: Record<string, string> = {};
        const searchParams: Record<string, string> = {};
        const [pathnamePart, searchParamPart] = url.split('?');
        if (searchParamPart) {
            searchParamPart.split('&').forEach((param) => {
                const [key, value] = param.split('=');
                searchParams[key] = decodeURIComponent(value || '');
            });
        }

        const matched = Object.entries(routeManifest).find(([path, entry]) => {
            const pattern = path.replace(/:[^/]+/g, '[^/]+').replace(/\*$/, '.*');
            const re = new RegExp(`^${pattern}$`);
            return re.test(pathnamePart);
        })?.[1] as RouteEntry;

        const routePath = matched ? (matched as RoutePageEntry).mainPage.manifestPath.split('/').slice(2).join('/') : '/';

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
                    const result = await handler(req, {
                        params: params,
                        searchParams: searchParams,
                    });
                    await sendNodeResponse(res, result);
                    return;
                } else {
                    throw new Error(`Method ${reqMethod} not implemented in ${matched.handler.src}`);
                }
            } else {
                throw new Error(`Unsupported request method: ${reqMethod}`);
            }
        } else {
            let loading = false;
            let html;
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
            const assetsHtml = assets.map((asset) => {
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
            const manifestHtml = `<script>window.manifest=${JSON.stringify(await clientManifest.json())}</script>`;
            let clientHydrationScript;

            res.setHeader('Content-Type', 'text/html');
            res.setHeader('Cache-Control', 'no-cache');
            try {
                if (!matched) {
                    try {
                        const notFoundPage = routeManifest['/'] as RoutePageEntry;
                        const { rendered, documentMeta } = await render(
                            'not-found',
                            notFoundPage,
                            {},
                            {},
                            req as unknown as Request
                        );
                        clientHydrationScript = `
                            <script type="module">
                            import main from '${clientManifest.inputs[clientManifest.handler].output.path}';
                            main('/not-found/',${JSON.stringify(params)},${JSON.stringify(searchParams)});
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
                        const { rendered, documentMeta } = await render(
                            'loading',
                            matched as RoutePageEntry,
                            params,
                            searchParams,
                            req as unknown as Request
                        );
                        const html = `
                            <!doctype html>
                            <html lang="en">
                                <head>
                                    ${generateHtmlHead({
                                    ...meta,
                                    ...documentMeta,
                                })}
                                    ${generateHydrationScript()}
                                </head>
                                <noscript>
                                    Please enable JavaScript to view the content.<br/>
                                </noscript>
                                ${rendered}
                            </html>
                            `;
                        res.write(html);
                        res.write(`
                        <script type="module" data-hydration="loading">
                            import main from '${clientManifest.inputs[clientManifest.handler].output.path}';
                            main('${(matched as RoutePageEntry).loadingPage.manifestPath}',${JSON.stringify(params)},${JSON.stringify(searchParams)});
                        </script>
                        `);
                        loading = true;
                    } catch (e) {
                        // skip
                    }
                    
                    const { rendered, documentMeta } = await render(
                        'main',
                        matched as RoutePageEntry,
                        params,
                        searchParams,
                        req as unknown as Request
                    );
                    clientHydrationScript = `
                        <script type="module">
                        import main from '${clientManifest.inputs[clientManifest.handler].output.path}';
                        main('${(matched as RoutePageEntry).mainPage.manifestPath}',${JSON.stringify(params)},${JSON.stringify(searchParams)});
                        </script>
                    `;
                    html = rendered;
                    meta = {
                        ...meta,
                        ...documentMeta
                    };
                }
            } catch (e1) {
                try {
                    const errorPage = (matched as RoutePageEntry).errorPage;
                    if (!errorPage) {
                        throw e1;
                    }
                    const { rendered, documentMeta } = await render(
                        'error',
                        matched as RoutePageEntry,
                        params,
                        searchParams,
                        req as unknown as Request
                    );
                    clientHydrationScript = `
                        <script type="module">
                        import main from '${clientManifest.inputs[clientManifest.handler].output.path}';
                        main('${errorPage.manifestPath}',${JSON.stringify(params)},${JSON.stringify(searchParams)});
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
                res.write(`
                    <script>
                    const head = document.querySelector('head');
                    const scripts = Array.from(head.querySelectorAll('script'));
                    head.innerHTML = \`${generateHtmlHead(meta)}\`;
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
            } else {
                const transformHtml = template
                    .replace(`<!--app-head-->`, generateHtmlHead(meta) + '\n' + assetsHtml + '\n' + generateHydrationScript())
                    .replace(`<!--app-body-->`, (html ?? '') + manifestHtml + clientHydrationScript);
                return res.end(transformHtml);
            }
        }
    } catch (e) {
        console.error(e);
        res.statusCode = 500;
        return res.end('Internal Server Error');
    }
});

export default handler;
