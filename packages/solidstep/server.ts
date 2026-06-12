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
import { Suspense, ErrorBoundary } from 'solid-js';
import { createDeferredResource } from './utils/deferred';
import type { Meta } from './utils/meta';
import fileRoutes, { type RouteModule } from 'vinxi/routes';
import { RedirectError } from './utils/redirect';
import {
    getCache,
    getCacheEntry,
    setCacheWithOptions,
    setCacheStore,
} from './utils/cache';
import { MemoryCacheStore, FilesystemCacheStore } from './utils/cache-store';
import { singleFlight } from './utils/single-flight';
import fetchServer from './utils/fetch.server';
import { getCachedLoaderData } from './utils/loader-cache';
import { runSequentialLoader } from './utils/loader-error';
import {
    expandRoute,
    type PatternSegment,
    type PrerenderTarget,
    type PrerenderOptions,
    type GenerateStaticParams,
} from './utils/prerender';
import { handleServerFunction } from './utils/server-action.server';
import { escapeHtml, escapeScript } from './utils/escape';
import { shouldCachePage, pageCacheKey } from './utils/page-cache';
import { SEROVAL_PLUGINS } from './utils/serialize';
import { serialize } from 'seroval';
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

// Header a self-fetch sets so the handler renders an ISR page fresh instead of
// serving (or recursing into) the ISR cache. Also set by the build-time crawler.
const ISR_BYPASS_HEADER = 'x-solidstep-isr-bypass';
// Internal, env-gated endpoint the build crawler hits to learn what to prerender.
const PRERENDER_ENDPOINT = '/__solidstep_prerender';
// Internal endpoint the client calls to fill a PPR page's dynamic holes: it runs
// a deferred loader (identified by its manifest path, validated against the
// matched route) and returns its data as JSON.
const LOADER_ENDPOINT = '/__solidstep_loader';

// Walk the route trie, reconstructing each page route's pattern segments so a
// concrete pathname can be built from generateStaticParams.
const walkPageRoutes = (
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

/**
 * Enumerate every concrete page to prerender (SSG/ISR). For each page route
 * with `options.render` of `'static'`/`'isr'`, this loads its `options` and (for
 * dynamic routes) `generateStaticParams`, then expands the pattern into concrete
 * {@link PrerenderTarget}s. Used by the build-time crawler.
 */
const collectPrerenderTargets = async (): Promise<PrerenderTarget[]> => {
    if (!routeManifest) {
        const manifest = await createRouteManifest();
        routeManifest = manifest.rootNode;
        metadataManifest = manifest.metadataMap;
    }
    const targets: PrerenderTarget[] = [];
    for (const { handler, segments } of walkPageRoutes(routeManifest)) {
        const optionsImport = handler.mainPage.options;
        const options = optionsImport
            ? (
                  await getCachedModule<{ options?: PrerenderOptions }>(
                      optionsImport,
                  )
              ).options
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
            const mod = await getCachedModule<{
                generateStaticParams?: GenerateStaticParams;
            }>(gspImport);
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

/**
 * Run a single deferred loader for a PPR page's hole and return its data as
 * JSON. `manifest` identifies the page/layout/group node; it is validated
 * against the route matched for `url` so only loaders on that route can run.
 * Returns `null` (→ 400) on a bad/unknown request.
 */
const serveHoleData = async (req: Request): Promise<string | null> => {
    const reqUrl = new URL(req.url);
    const manifest = reqUrl.searchParams.get('manifest');
    const target = reqUrl.searchParams.get('url');
    if (!manifest || !target) return null;

    if (!routeManifest) {
        const m = await createRouteManifest();
        routeManifest = m.rootNode;
        metadataManifest = m.metadataMap;
    }

    const targetUrl = new URL(target, reqUrl.origin);
    const match = matchRoute(routeManifest, targetUrl.pathname);
    if (!match || match.handler.type !== 'page') return null;
    const page = match.handler as RoutePageHandler;

    // Find the loader import for `manifest`, but only among nodes that belong to
    // this matched route (page, its layouts, its groups).
    let loaderImport: Import | undefined;
    if (page.mainPage.manifestPath === manifest) {
        loaderImport = page.mainPage.loader as Import | undefined;
    } else {
        for (const l of page.layouts) {
            if (l.manifestPath === manifest) loaderImport = l.loader as Import;
        }
        for (const g of Object.values(page.groups || {})) {
            if (g.manifestPath === manifest) loaderImport = g.loader as Import;
        }
    }
    if (!loaderImport) return null;

    const { loader: loaderFn } = await getCachedModule<{ loader: any }>(
        loaderImport,
    );
    if (!loaderFn) return null;

    // Run the loader against the original page URL so its params/search (and
    // loader cache key) are correct.
    const pageReq = new Request(targetUrl.toString(), { headers: req.headers });
    const data = await getCachedLoaderData(loaderFn, manifest, pageReq);
    return JSON.stringify({ data });
};

// ISR entries never hard-expire (~10y) so a stale artifact is always served
// while it regenerates in the background.
const ISR_SWR_MAX = 1000 * 60 * 60 * 24 * 365 * 10;

// Regenerate an ISR page by self-fetching it with the bypass header (so the
// handler renders it fresh), then refresh the cached artifact.
const regenerateIsr = async (
    origin: string,
    pathname: string,
    revalidate: number,
    tags?: string[],
): Promise<string> => {
    const res = await fetchServer(
        origin + pathname,
        {
            method: 'GET',
            headers: { [ISR_BYPASS_HEADER]: '1' },
            MAX_FETCH_TIME: 30_000,
        },
        false,
    );
    const html = await res.text();
    await setCacheWithOptions(`isr:${pathname}`, html, {
        ttl: revalidate * 1000,
        swr: ISR_SWR_MAX,
        tags,
    });
    return html;
};

/**
 * Serve an ISR page's cached full-HTML artifact with stale-while-revalidate:
 * fresh hits return immediately; stale hits return the stale artifact and kick
 * off one coalesced background regeneration; a cold miss renders on demand.
 */
const serveIsr = async (
    origin: string,
    pathname: string,
    revalidate: number,
    tags?: string[],
): Promise<string> => {
    const key = `isr:${pathname}`;
    const entry = await getCacheEntry<string>(key);
    if (entry) {
        if (entry.staleAt === null || Date.now() < entry.staleAt) {
            return entry.value;
        }
        singleFlight(key, () =>
            regenerateIsr(origin, pathname, revalidate, tags),
        ).catch(() => undefined);
        return entry.value;
    }
    return singleFlight(key, () =>
        regenerateIsr(origin, pathname, revalidate, tags),
    );
};

// Shape of `prerender-manifest.json` written by the build crawler into the
// server output directory.
type PrerenderManifest = {
    isr?: {
        pathname: string;
        revalidate: number;
        tags?: string[];
        file: string;
    }[];
};

// Seed prerendered ISR artifacts into the cache so the first request after a
// (re)start serves the build-time HTML, then revalidates per its interval.
const seedIsrFromManifest = async (serverDir: string): Promise<void> => {
    let raw: string;
    try {
        raw = await readFile(`${serverDir}/prerender-manifest.json`, 'utf-8');
    } catch {
        return; // no ISR pages were prerendered
    }
    let manifest: PrerenderManifest;
    try {
        manifest = JSON.parse(raw);
    } catch {
        return;
    }
    for (const entry of manifest.isr ?? []) {
        try {
            const html = await readFile(`${serverDir}/${entry.file}`, 'utf-8');
            await setCacheWithOptions(`isr:${entry.pathname}`, html, {
                ttl: (entry.revalidate || 60) * 1000,
                swr: ISR_SWR_MAX,
                tags: entry.tags,
            });
        } catch {
            // Skip a missing/unreadable artifact.
        }
    }
};

const template = `
    <!DOCTYPE html>
    <html lang="en">
    <head><!--app-head--></head>
    <!--app-body-->
    </html>
`;

// Serialize an attribute bag to a `key="value"` string with HTML-escaped values
// so an attribute value can never break out of its quotes.
const serializeAttributes = (attributes: Record<string, unknown>): string =>
    Object.entries(attributes)
        .map(
            ([attrKey, attrValue]) =>
                `${attrKey}="${escapeHtml(String(attrValue))}"`,
        )
        .join(' ');

const generateHtmlHead = (meta: Meta) => {
    const head = Object.entries(meta)
        .map(([key, value]) => {
            if (value.type === 'title') {
                return `<title>${escapeHtml(String(value.content ?? ''))}</title>`;
            }

            if (value.type === 'meta') {
                return `<meta ${serializeAttributes(value.attributes)}>`;
            }

            if (
                value.type === 'link' ||
                value.type === 'style' ||
                value.type === 'script'
            ) {
                return `<${value.type} ${serializeAttributes(value.attributes)}></${value.type}>`;
            }
            return '';
        })
        .join('\n');
    return head;
};

// Render the per-module client asset list (collected from the Vite manifest)
// into `<script>`/`<link>`/`<style>` tags. Attribute values and inline style
// content are HTML-escaped, and script tags carry the CSP nonce when present.
// Replaces five near-identical inline blocks that previously did this unescaped.
const renderAssetsToHtml = (
    assets: {
        tag: string;
        attrs: Record<string, unknown>;
        children?: string;
    }[],
    cspNonce?: string,
    // The loading head-swap re-appends existing <script> elements itself, so it
    // asks for link/style only to avoid duplicating scripts.
    includeScripts = true,
): string =>
    assets
        .map((asset) => {
            const attributeString = serializeAttributes(asset.attrs);
            if (asset.tag === 'script') {
                return includeScripts
                    ? `<script ${attributeString} ${cspNonce ? `nonce="${cspNonce}"` : ''}></script>`
                    : '';
            }
            if (asset.tag === 'link') {
                return `<link ${attributeString}>`;
            }
            if (asset.tag === 'style') {
                return `<style ${attributeString}>${escapeHtml(asset.children || '')}</style>`;
            }
            return '';
        })
        .join('\n');

// Serialize a fully-resolved value (loader data) into a self-contained JS
// expression for embedding inside an inline `<script>`. seroval reconstructs
// non-JSON values (Date/Map/Set/BigInt) on the client — matching the
// server-action transport — and already escapes `<` (to `\x3C`) plus the JS
// line terminators inside its string literals, so its output is script-safe as
// emitted. It must NOT be passed through `escapeScript`: the expression
// contains operators (e.g. an arrow-function wrapper) outside string literals
// that escaping would corrupt.
const serializeForScript = (value: unknown): string =>
    serialize(value, { plugins: SEROVAL_PLUGINS });

// Plain JSON payload (params/searchParams are always strings) escaped for safe
// inline-script embedding.
const jsonForScript = (value: unknown): string =>
    escapeScript(JSON.stringify(value));

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
    // SSG (`static`), ISR, and PPR pages have their own artifact/ISR cache (or a
    // shell artifact); plain dynamic pages are cached only when they opt in with
    // a positive `cache.ttl`. The key includes the query string so `?q=a` and
    // `?q=b` don't collide. See `utils/page-cache`.
    const isPPR = pageOptions?.render === 'ppr';
    const shouldCache = shouldCachePage(pageOptions);
    const cacheKey = pageCacheKey(url);
    const cachedEntry = shouldCache
        ? await getCache<{
              rendered: string;
              documentMeta: Meta;
              documentAssets: any[];
              loaderData: Record<string, any>;
          }>(cacheKey)
        : null;

    if (cachedEntry && toRender === 'main') {
        return {
            rendered: cachedEntry.rendered,
            documentMeta: cachedEntry.documentMeta,
            documentAssets: cachedEntry.documentAssets,
            loaderData: cachedEntry.loaderData,
        };
    }

    type CacheOptions = {
        ttl?: number;
        swr?: number;
        tags?: string[];
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
                // PPR: don't run the loader at build/shell time — leave the hole
                // pending so `renderToString` emits its fallback. The client
                // fetches the data and fills it in.
                if (isPPR) {
                    deferredLoaderData.set(
                        manifestPath,
                        new Promise<any>(() => undefined),
                    );
                    return;
                }
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
            // Isolate sequential loader failures: a layout/group loader that
            // throws yields a serializable error sentinel (siblings still
            // render); only the page loader re-throws to the route error page.
            const data = await runSequentialLoader(
                loaderFn,
                manifestPath,
                req,
                manifestPath === pageToRender?.manifestPath,
            );
            resolvedLoaderData.set(manifestPath, data);
        }),
    );
    const hasDeferred = deferredLoaderData.size > 0;
    // Set by the group loop below when a group has a loading/error boundary or a
    // deferred loader — such routes also take the streaming path.
    let hasStreamingGroup = false;

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
                            const slotName = groupName.replace('@', '');
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

                            const groupDeferred =
                                groupLoader?.options?.type === 'defer';
                            const needsWrap =
                                !!group.loadingPage ||
                                !!group.errorPage ||
                                groupDeferred;

                            // Plain group (no boundary): await its loader and
                            // pass the data directly, exactly as before.
                            if (!needsWrap) {
                                let data: any = {};
                                if (groupLoader) {
                                    // Isolate: a failing plain-group loader
                                    // yields a sentinel rather than taking down
                                    // the whole render.
                                    data = await runSequentialLoader(
                                        groupLoader,
                                        group.manifestPath,
                                        req,
                                        false,
                                    );
                                    loaderData[group.manifestPath] = data;
                                }
                                slots[slotName] = () =>
                                    groupPage({
                                        routeParams,
                                        searchParams,
                                        loaderData: data,
                                    });
                                return;
                            }

                            // Boundary group: render via <Suspense>/<ErrorBoundary>
                            // so its loading.tsx/error.tsx isolate this slot.
                            hasStreamingGroup = true;
                            let GroupLoading: any = null;
                            let GroupError: any = null;
                            if (group.loadingPage) {
                                const src = `${group.loadingPage.src}&pick=$css`;
                                assets.push(
                                    ...(await clientManifest.inputs[
                                        src
                                    ].assets()),
                                );
                                GroupLoading = (
                                    await getCachedModule<{ default: any }>(
                                        group.loadingPage,
                                    )
                                ).default;
                            }
                            if (group.errorPage) {
                                const src = `${group.errorPage.src}&pick=$css`;
                                assets.push(
                                    ...(await clientManifest.inputs[
                                        src
                                    ].assets()),
                                );
                                GroupError = (
                                    await getCachedModule<{ default: any }>(
                                        group.errorPage,
                                    )
                                ).default;
                            }
                            // A boundary group with a loader streams its data in
                            // as a resource (so loader errors reach the
                            // ErrorBoundary and hydrate consistently).
                            let pending: Promise<any> | null = null;
                            if (groupLoader) {
                                if (isPPR && groupDeferred) {
                                    // PPR hole: leave pending so the shell shows
                                    // the fallback; the client fetches it.
                                    pending = new Promise<any>(() => undefined);
                                } else {
                                    pending = getCachedLoaderData(
                                        groupLoader,
                                        group.manifestPath,
                                        req,
                                    );
                                    pending.catch(() => undefined);
                                }
                                deferredLoaderData.set(
                                    group.manifestPath,
                                    pending,
                                );
                            }
                            slots[slotName] = () => {
                                const inner = () => {
                                    if (!pending) {
                                        return groupPage({
                                            routeParams,
                                            searchParams,
                                            loaderData: {},
                                        });
                                    }
                                    const resource =
                                        createDeferredResource(pending);
                                    return createComponent(Suspense, {
                                        fallback: GroupLoading
                                            ? createComponent(GroupLoading, {
                                                  routeParams,
                                                  searchParams,
                                              })
                                            : undefined,
                                        get children() {
                                            return groupPage({
                                                routeParams,
                                                searchParams,
                                                loaderData: resource,
                                            });
                                        },
                                    });
                                };
                                if (GroupError) {
                                    return createComponent(ErrorBoundary, {
                                        fallback: (err: any) =>
                                            createComponent(GroupError, {
                                                error: err,
                                                routeParams,
                                                searchParams,
                                            }),
                                        get children() {
                                            return inner();
                                        },
                                    });
                                }
                                return inner();
                            };
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
    // PPR renders a synchronous shell (holes stay pending → fallback) via
    // renderToString below; it does NOT stream. Other deferred routes stream.
    if ((hasDeferred || hasStreamingGroup) && toRender === 'main' && !isPPR) {
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

    // PPR shell: return the shell HTML plus the hole manifest paths so the
    // handler can tell the client which holes to fetch and fill.
    if (isPPR && toRender === 'main') {
        return {
            rendered,
            documentMeta: meta,
            documentAssets: assets,
            loaderData,
            pprHoles: [...deferredLoaderData.keys()],
        };
    }

    if (toRender === 'main' && shouldCache) {
        const options = pageOptions?.cache as CacheOptions | undefined;
        await setCacheWithOptions(
            cacheKey,
            {
                rendered: rendered,
                documentMeta: meta,
                documentAssets: assets,
                loaderData: loaderData,
            },
            {
                ttl: options?.ttl ? options.ttl : 0,
                swr: options?.swr,
                tags: options?.tags,
            },
        );
    }

    return {
        rendered: rendered,
        documentMeta: meta,
        documentAssets: assets,
        loaderData: loaderData,
    };
};

// Whether a matched page route needs the streaming (renderToStream) path: the
// page loader is deferred, or any parallel-route group has a loading/error
// boundary or a deferred loader. Loader modules are cached, so imports are cheap.
const routeNeedsStreaming = async (
    entry: RoutePageHandler,
): Promise<boolean> => {
    const pageLoader = entry.mainPage.loader;
    if (pageLoader) {
        const { loader: loaderFn } = await getCachedModule<{ loader: any }>(
            pageLoader as Import,
        );
        if (loaderFn?.options?.type === 'defer') return true;
    }
    for (const group of Object.values(entry.groups || {})) {
        if (group.loadingPage || group.errorPage) return true;
        if (group.loader) {
            const { loader: loaderFn } = await getCachedModule<{ loader: any }>(
                group.loader as Import,
            );
            if (loaderFn?.options?.type === 'defer') return true;
        }
    }
    return false;
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
    // The built server's `import.meta.url` is not always a usable absolute file
    // URL (notably on Windows in the Nitro bundle), so derive the server output
    // directory from the entry path (`node .output/server/index.mjs`). This is
    // where `.config.json` and `prerender-manifest.json` are written at build.
    let serverDir: string;
    try {
        serverDir = dirname(process.argv[1] || fileURLToPath(import.meta.url));
    } catch {
        serverDir = process.cwd();
    }
    try {
        const manifest = await createRouteManifest();
        routeManifest = manifest.rootNode;
        metadataManifest = manifest.metadataMap;
        let sharedConfig = (globalThis as any).__SOLIDSTEP_CONFIG__;
        if (!sharedConfig) {
            const configContent = await readFile(
                `${serverDir}/.config.json`,
                'utf-8',
            );
            sharedConfig = JSON.parse(configContent);
            // @ts-ignore
            globalThis.__SOLIDSTEP_CONFIG__ = sharedConfig;
        }

        // Select the built-in cache backend from config. Applied before
        // instrumentation `register()` so a user `setCacheStore(...)` there
        // (e.g. a Redis adapter) can override it.
        const cacheConfig = sharedConfig?.cache as
            | { type?: 'memory'; maxEntries?: number }
            | { type: 'filesystem'; dir: string }
            | undefined;
        if (cacheConfig?.type === 'filesystem') {
            setCacheStore(new FilesystemCacheStore({ dir: cacheConfig.dir }));
        } else if (cacheConfig?.maxEntries) {
            setCacheStore(
                new MemoryCacheStore({ maxEntries: cacheConfig.maxEntries }),
            );
        }
    } catch (e) {
        console.error('Error creating route manifest:', e);
    }

    // Load instrumentation
    const instrumentation = await loadInstrumentation();
    if (instrumentation?.register) {
        await safeExecuteHook('register', instrumentation.register);
    }

    // Seed ISR artifacts (written by the build-time crawler) into the active
    // cache store so the first request is warm. Done after register() so a
    // user-provided store is the one being seeded.
    await seedIsrFromManifest(serverDir);
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

        // Build-time prerender discovery. Only answered when the process was
        // started in prerender mode (the build crawler sets this env var), so it
        // is never reachable in a normal production server.
        if (
            process.env.SOLIDSTEP_PRERENDER === '1' &&
            new URL(req.url).pathname === PRERENDER_ENDPOINT
        ) {
            setHeader('Content-Type', 'application/json');
            return JSON.stringify(await collectPrerenderTargets());
        }

        if (!routeManifest) {
            const manifest = await createRouteManifest();
            routeManifest = manifest.rootNode;
            metadataManifest = manifest.metadataMap;
        }

        if (!clientManifest) {
            clientManifest = getManifest('client');
        }

        // PPR hole data: the client fetches a deferred loader's data here to fill
        // a partially-prerendered page's dynamic holes.
        if (new URL(req.url).pathname === LOADER_ENDPOINT) {
            const body = await serveHoleData(req);
            if (body === null) {
                setResponseStatus(400);
                return 'Bad Request';
            }
            setHeader('Content-Type', 'application/json');
            return body;
        }

        const cspNonce = (event as any).locals?.cspNonce as string | undefined;

        const urlObj = new URL(req.url);
        const pathnamePart = urlObj.pathname;
        const searchParams = Object.fromEntries(urlObj.searchParams);
        const isrBypass = req.headers.get(ISR_BYPASS_HEADER) === '1';

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

        // ISR: serve a cached full-HTML artifact with stale-while-revalidate.
        // Skipped in dev and for self-fetch/crawler requests (bypass header), so
        // those render fresh through the normal path below.
        if (
            matched &&
            matched.type === 'page' &&
            !import.meta.env.DEV &&
            !isrBypass
        ) {
            const optionsImport = (matched as RoutePageHandler).mainPage
                .options;
            const pageOptions = optionsImport
                ? (
                      await getCachedModule<{ options?: PrerenderOptions }>(
                          optionsImport,
                      )
                  ).options
                : undefined;
            if (pageOptions?.render === 'isr') {
                const revalidate =
                    pageOptions.revalidate && pageOptions.revalidate > 0
                        ? pageOptions.revalidate
                        : 60;
                const isrHtml = await serveIsr(
                    urlObj.origin,
                    pathnamePart,
                    revalidate,
                    pageOptions.cache?.tags,
                );
                setHeader('Content-Type', 'text/html');
                setHeader(
                    'Cache-Control',
                    `public, max-age=0, s-maxage=${revalidate}, stale-while-revalidate`,
                );
                setResponseStatus(200);
                const respCtx = createResponseContext(reqCtx, 200);
                await safeExecuteHook(
                    'onResponseEnd',
                    inst?.onResponseEnd,
                    req,
                    respCtx,
                );
                return isrHtml;
            }
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
        const manifestHtml = `<script ${cspNonce ? `nonce="${cspNonce}"` : ''}>window.manifest=${escapeScript(JSON.stringify(await clientManifest.json()))}</script>`;

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
                                main('/not-found/',${jsonForScript(params)},${jsonForScript(searchParams)}, ${serializeForScript(loaderData)});
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

                            // PPR: render and serve the static shell (deferred
                            // holes left as their loading fallback). The client
                            // fills the holes by fetching their loader data. The
                            // build crawler captures this shell as a .html
                            // artifact; dev and prod-fallback both render here.
                            if (options?.render === 'ppr') {
                                const result = (await render({
                                    toRender: 'main',
                                    entry: matched as RoutePageHandler,
                                    routeParams: params,
                                    searchParams,
                                    req,
                                    pageOptions: options,
                                    cspNonce,
                                })) as any;
                                const assetsHtml = renderAssetsToHtml(
                                    result.documentAssets as any[],
                                    cspNonce,
                                );
                                const headHtml = `${generateHtmlHead({
                                    ...meta,
                                    ...result.documentMeta,
                                })}\n${assetsHtml}\n${hydrationScript({ nonce: cspNonce })}`;
                                const entryPath =
                                    clientManifest!.inputs[
                                        clientManifest!.handler
                                    ].output.path;
                                // Trailing `true` flags PPR so the client fetches
                                // each hole's loader data instead of waiting for
                                // streamed hydration.
                                const mainScript = `<script type="module" ${cspNonce ? `nonce="${cspNonce}"` : ''}>import main from '${entryPath}';main(${jsonForScript((matched as RoutePageHandler).mainPage.manifestPath)},${jsonForScript(params)},${jsonForScript(searchParams)},${serializeForScript(result.loaderData)},${jsonForScript(result.pprHoles)},true);</script>`;
                                setResponseStatus(200);
                                push(
                                    `<!doctype html><html lang="en"><head>${headHtml}</head>${result.rendered}${manifestHtml}${mainScript}</html>`,
                                );
                                controller.close();
                                return;
                            }

                            // Deferred route: stream the shell immediately and
                            // stream deferred loader data in afterwards via Solid's
                            // renderToStream + Suspense. Non-deferred routes fall
                            // through to the unchanged renderToString path below.
                            if (
                                await routeNeedsStreaming(
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
                                const assetsHtml = renderAssetsToHtml(
                                    result.documentAssets as any[],
                                    cspNonce,
                                );
                                const headHtml = `${generateHtmlHead({
                                    ...meta,
                                    ...result.documentMeta,
                                })}\n${assetsHtml}\n${hydrationScript({ nonce: cspNonce })}`;
                                const entryPath =
                                    clientManifest!.inputs[
                                        clientManifest!.handler
                                    ].output.path;
                                const mainScript = `<script type="module" ${cspNonce ? `nonce="${cspNonce}"` : ''}>import main from '${entryPath}';main(${jsonForScript((matched as RoutePageHandler).mainPage.manifestPath)},${jsonForScript(params)},${jsonForScript(searchParams)},${serializeForScript(result.loaderData)},${jsonForScript(result.deferredKeys)});</script>`;
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
                                const assetsHtml = renderAssetsToHtml(
                                    assets.concat(documentAssets),
                                    cspNonce,
                                );
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
                                main(${jsonForScript((matched as RoutePageHandler).loadingPage?.manifestPath)},${jsonForScript(params)},${jsonForScript(searchParams)}, ${serializeForScript(loaderData)});
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
                            main(${jsonForScript((matched as RoutePageHandler).mainPage.manifestPath)},${jsonForScript(params)},${jsonForScript(searchParams)}, ${serializeForScript(loaderData)});
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
                            main(${jsonForScript(errorPage.manifestPath)},${jsonForScript(params)},${jsonForScript(searchParams)}, ${serializeForScript(loaderData)});
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
                        const assetsHtml = renderAssetsToHtml(
                            assets,
                            cspNonce,
                            false,
                        );
                        push(`<template id="__page_html__">${html}</template>`);
                        push(`
                        <script ${cspNonce ? `nonce="${cspNonce}"` : ''}>
                        const head = document.querySelector('head');
                        const scripts = Array.from(head.querySelectorAll('script'));
                        head.innerHTML = ${escapeScript(JSON.stringify(generateHtmlHead(meta) + assetsHtml))};
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
                    const assetsHtml = renderAssetsToHtml(assets, cspNonce);
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
