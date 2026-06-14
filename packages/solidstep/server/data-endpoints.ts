import { serialize } from 'seroval';
import type { Meta } from '../utils/meta';
import { RedirectError } from '../utils/redirect';
import { getCachedLoaderData } from '../utils/loader-cache';
import { runSequentialLoader } from '../utils/loader-error';
import { SEROVAL_PLUGINS } from '../utils/serialize';
import {
    matchRoute,
    type Import,
    type RoutePageHandler,
} from '../utils/path-router';
import { ensureRouteManifest, getCachedModule } from './route-manifest';
import type { LoaderModule, MetaModule } from './types';

/**
 * Run a single deferred loader for a PPR page's hole and return its data as
 * JSON. `manifest` identifies the page/layout/group node; it is validated
 * against the route matched for `url` so only loaders on that route can run.
 * Returns `null` (→ 400) on a bad/unknown request.
 */
export const serveHoleData = async (req: Request): Promise<string | null> => {
    const reqUrl = new URL(req.url);
    const manifest = reqUrl.searchParams.get('manifest');
    const target = reqUrl.searchParams.get('url');
    if (!manifest || !target) return null;

    const routeManifest = await ensureRouteManifest();

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

    const { loader: loaderFn } =
        await getCachedModule<LoaderModule>(loaderImport);
    if (!loaderFn) return null;

    // Run the loader against the original page URL so its params/search (and
    // loader cache key) are correct.
    const pageReq = new Request(targetUrl.toString(), { headers: req.headers });
    const data = await getCachedLoaderData(loaderFn, manifest, pageReq);
    return JSON.stringify({ data });
};

/**
 * Resolve everything the client needs to render a matched page route on a soft
 * navigation, WITHOUT building a Solid tree: every non-deferred layout/page/group
 * loader is run and every node's `generateMeta` is merged in tree order.
 *
 * **Deferred (`type: 'defer'`) loaders are NOT run here** — their manifestPaths
 * are reported in `deferredKeys` and the client fills each hole from the
 * `/__solidstep_loader` endpoint under `<Suspense fallback={loading.tsx}>`. This
 * makes a deferred route's shell commit instantly on navigation (with its loader
 * boundary showing) instead of blocking on the slow data, matching how `defer`
 * behaves on first-load.
 *
 * This is a standalone pass that reuses the same per-node primitives as
 * `render()` (`runSequentialLoader`, `getCachedModule`) so caching, SWR, and
 * loader-error isolation match — but it deliberately does NOT touch `render()`'s
 * control flow (which interleaves loaders with tree-building).
 *
 * @returns `loaderData` keyed by manifestPath (non-deferred only), the deferred
 *   manifestPaths, and merged `meta`. The page loader re-throws on failure
 *   (caller maps it to an error/redirect envelope); layout/group failures yield
 *   the usual sentinel.
 */
export const resolveRouteData = async (
    entry: RoutePageHandler,
    req: Request,
    cspNonce?: string,
): Promise<{
    loaderData: Record<string, unknown>;
    deferredKeys: string[];
    meta: Meta;
}> => {
    const loaderData: Record<string, unknown> = {};
    const deferredKeys: string[] = [];

    // Loader targets: layouts + page + groups. `isPage` controls error
    // isolation (the page loader re-throws; everything else yields a sentinel).
    const loaderTargets: {
        manifestPath: string;
        loader?: Import;
        isPage: boolean;
    }[] = [
        ...entry.layouts.map((l) => ({
            manifestPath: l.manifestPath,
            loader: l.loader as Import | undefined,
            isPage: false,
        })),
        {
            manifestPath: entry.mainPage.manifestPath,
            loader: entry.mainPage.loader as Import | undefined,
            isPage: true,
        },
        ...Object.values(entry.groups || {}).map((g) => ({
            manifestPath: g.manifestPath,
            loader: g.loader as Import | undefined,
            isPage: false,
        })),
    ];

    await Promise.all(
        loaderTargets.map(async ({ manifestPath, loader, isPage }) => {
            if (!loader) return;
            const { loader: loaderFn } =
                await getCachedModule<LoaderModule>(loader);
            if (!loaderFn) return;
            // Deferred loaders are left unresolved: report the hole and let the
            // client stream it in via `/__solidstep_loader` under <Suspense>.
            if (loaderFn.options?.type === 'defer') {
                deferredKeys.push(manifestPath);
                return;
            }
            loaderData[manifestPath] = await runSequentialLoader(
                loaderFn,
                manifestPath,
                req,
                isPage,
            );
        }),
    );

    // Merge metadata in tree order (root layout → leaf layout → page), so the
    // page wins ties — matching `render()`'s precedence.
    let meta: Meta = {};
    const metaTargets: (Import | undefined)[] = [
        ...entry.layouts.map((l) => l.generateMeta as Import | undefined),
        entry.mainPage.generateMeta as Import | undefined,
    ];
    for (const generateMetaImport of metaTargets) {
        if (!generateMetaImport) continue;
        const { generateMeta } =
            await getCachedModule<MetaModule>(generateMetaImport);
        if (typeof generateMeta === 'function') {
            const metaData = await generateMeta({ req, cspNonce });
            if (metaData) meta = { ...meta, ...metaData };
        }
    }

    return { loaderData, deferredKeys, meta };
};

/**
 * Soft-navigation data endpoint. Matches `?url=<pathname+search>` and returns a
 * seroval-serialized **envelope** describing how the client should render that
 * route. Redirects/errors/not-found are encoded in the envelope (not as HTTP
 * status) so a client `fetch` doesn't transparently follow or fail. Returns
 * `null` on a malformed request (→ 400).
 */
export const serveRouteData = async (
    req: Request,
    cspNonce?: string,
): Promise<string | null> => {
    const reqUrl = new URL(req.url);
    const target = reqUrl.searchParams.get('url');
    if (!target) return null;

    const routeManifest = await ensureRouteManifest();

    const targetUrl = new URL(target, reqUrl.origin);
    const params = Object.fromEntries(targetUrl.searchParams);
    const ser = (value: unknown) =>
        serialize(value, { plugins: SEROVAL_PLUGINS });

    const match = matchRoute(routeManifest, targetUrl.pathname);
    if (!match) {
        return ser({ type: 'not-found' });
    }
    if (match.handler.type !== 'page') {
        // API route — the client must hard-navigate to it.
        return ser({ type: 'route' });
    }

    const entry = match.handler as RoutePageHandler;
    const routeParams = match.params || {};
    // Run loaders against the target URL so params/search + cache keys are right.
    const pageReq = new Request(targetUrl.toString(), { headers: req.headers });

    try {
        const { loaderData, deferredKeys, meta } = await resolveRouteData(
            entry,
            pageReq,
            cspNonce,
        );
        return ser({
            type: 'page',
            manifestPath: entry.mainPage.manifestPath,
            params: routeParams,
            searchParams: params,
            loaderData,
            deferredKeys,
            meta,
        });
    } catch (err: any) {
        if (err instanceof RedirectError || err?.name === 'RedirectError') {
            return ser({ type: 'redirect', location: err.message });
        }
        // The page loader threw: render the route's error boundary client-side
        // if one exists, otherwise surface a not-found.
        if (entry.errorPage) {
            return ser({
                type: 'error',
                errorPageManifest: entry.errorPage.manifestPath,
                params: routeParams,
                searchParams: params,
                message: err instanceof Error ? err.message : String(err),
            });
        }
        return ser({ type: 'not-found' });
    }
};
