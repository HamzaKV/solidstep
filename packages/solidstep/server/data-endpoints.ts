import { randomUUID } from 'node:crypto';
import { serialize } from 'seroval';
import type { Meta } from '../utils/meta.js';
import { RedirectError } from '../utils/redirect.js';
import { getCachedLoaderData } from '../utils/loader-cache.js';
import { runSequentialLoader } from '../utils/loader-error.js';
import { SEROVAL_PLUGINS } from '../utils/serialize.js';
import { logger } from '../utils/logger.js';
import {
    matchRoute,
    parseSearchParams,
    type Import,
    type RoutePageHandler,
} from '../utils/path-router.js';
import { ensureRouteManifest, getCachedModule } from './route-manifest.js';
import type { LoaderModule, MetaModule } from './types.js';

/**
 * Run a single deferred loader for a PPR page's hole and return its data as a
 * seroval-serialized envelope. `manifest` identifies the page/layout/group node;
 * it is validated against the route matched for `url` so only loaders on that
 * route can run. Returns `null` (→ 400) on a bad/unknown request.
 *
 * Uses seroval (not JSON) to match the soft-navigation envelope and the
 * first-load streamed path, so deferred loader data containing `Date` / `Map` /
 * `Set` / `BigInt` survives the round trip identically across every data path.
 */
export const serveHoleData = async (
    req: Request,
    locals?: Record<string, unknown>,
): Promise<string | null> => {
    const reqUrl = new URL(req.url);
    const manifest = reqUrl.searchParams.get('manifest');
    const target = reqUrl.searchParams.get('url');
    if (!manifest || !target) return null;

    const routeManifest = await ensureRouteManifest();

    const targetUrl = new URL(target, reqUrl.origin);
    const match = matchRoute(routeManifest, targetUrl.pathname);
    if (match?.handler.type !== 'page') return null;
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
    // Only deferred loaders are holes; refuse to run a regular loader that
    // happens to be addressable by manifest path.
    if (loaderFn.options?.type !== 'defer') return null;

    // Run the loader against the original page URL so its params/search (and
    // loader cache key) are correct. The client-disconnect signal is forwarded
    // so a hung hole loader can be cancelled.
    const pageReq = new Request(targetUrl.toString(), {
        headers: req.headers,
        signal: req.signal,
    });
    try {
        const data = await getCachedLoaderData(loaderFn, manifest, pageReq, {
            locals,
            signal: pageReq.signal,
        });
        return serialize({ data }, { plugins: SEROVAL_PLUGINS });
    } catch (err) {
        // A throwing hole loader must yield a seroval `{ error }` envelope the
        // client can deserialize and rethrow under its ErrorBoundary — never a
        // raw 500 with an HTML body. Same message policy as `serveRouteData`:
        // real message in dev, generic + correlation id in production.
        const rawMessage = err instanceof Error ? err.message : String(err);
        let message: string;
        if (import.meta.env.DEV) {
            message = rawMessage;
        } else {
            const errorId = randomUUID();
            logger.error(
                {
                    errorId,
                    err: rawMessage,
                    manifest,
                    route: targetUrl.pathname,
                },
                'Deferred hole loader failed',
            );
            message = `An unexpected error occurred (ref: ${errorId}).`;
        }
        return serialize({ error: message }, { plugins: SEROVAL_PLUGINS });
    }
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
    locals?: Record<string, unknown>,
): Promise<{
    loaderData: Record<string, unknown>;
    deferredKeys: string[];
    meta: Meta;
}> => {
    const loaderData: Record<string, unknown> = {};
    const deferredKeys: string[] = [];
    // Threaded into each loader: middleware `locals` (+ nonce, matching render)
    // and the request's abort signal.
    const invocation = {
        locals: { ...locals, cspNonce },
        signal: req.signal,
    };

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
                invocation,
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
    locals?: Record<string, unknown>,
): Promise<string | null> => {
    const reqUrl = new URL(req.url);
    const target = reqUrl.searchParams.get('url');
    if (!target) return null;

    const routeManifest = await ensureRouteManifest();

    const targetUrl = new URL(target, reqUrl.origin);
    const params = parseSearchParams(targetUrl.searchParams);
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
    // Forward the client-disconnect signal so a hung loader can be cancelled.
    const pageReq = new Request(targetUrl.toString(), {
        headers: req.headers,
        signal: req.signal,
    });

    try {
        const { loaderData, deferredKeys, meta } = await resolveRouteData(
            entry,
            pageReq,
            cspNonce,
            locals,
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
            const rawMessage = err instanceof Error ? err.message : String(err);
            // Don't leak internal error text (SQL, file paths, secrets) to the
            // client in production: log it server-side under a correlation id and
            // send only a generic message + the id. In dev, send the real message.
            const errorId = randomUUID();
            let message: string;
            if (import.meta.env.DEV) {
                message = rawMessage;
            } else {
                logger.error(
                    { errorId, err: rawMessage, route: targetUrl.pathname },
                    'Page loader failed during soft navigation',
                );
                message = `An unexpected error occurred (ref: ${errorId}).`;
            }
            return ser({
                type: 'error',
                errorPageManifest: entry.errorPage.manifestPath,
                params: routeParams,
                searchParams: params,
                message,
                errorId,
            });
        }
        return ser({ type: 'not-found' });
    }
};
