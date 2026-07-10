import { getManifest } from 'vinxi/manifest';
import type { ClientImport, ClientPageHandler } from './client-manifest.js';

/**
 * Synchronous client component-module cache. The reactive route tree in
 * `client.ts` must read components synchronously while rendering, so a
 * navigation preloads every module a route needs (`preloadHandler`) into this
 * cache before committing the new route state; the tree then reads them via
 * `getModule`.
 */

type LoadedModule = { default: any; [key: string]: any };

const cache = new Map<string, LoadedModule>();

/** Import a component module (DEV: via the Vite manifest), caching by `src`. */
export const loadModule = async (imp: ClientImport): Promise<LoadedModule> => {
    const cached = cache.get(imp.src);
    if (cached) return cached;
    const mod = import.meta.env.DEV
        ? await getManifest('client').inputs[imp.src].import()
        : await imp.import();
    cache.set(imp.src, mod);
    return mod;
};

/** Synchronously read an already-loaded module (or `undefined` if not yet loaded). */
export const getModule = (src: string): LoadedModule | undefined =>
    cache.get(src);

/**
 * Eagerly load every component module a route needs (page, layouts, groups,
 * boundaries). Rejects when any chunk fails to load — callers deciding to
 * commit a route must let that rejection reach their hard-navigation fallback
 * (committing anyway would render a blank tree from missing modules); purely
 * speculative callers (prefetch) attach their own `.catch`.
 */
export const preloadHandler = async (
    handler: ClientPageHandler,
): Promise<void> => {
    const imports: ClientImport[] = [
        handler.mainPage.page,
        ...handler.layouts.map((l) => l.layout),
    ];
    if (handler.loadingPage) imports.push(handler.loadingPage.page);
    if (handler.errorPage) imports.push(handler.errorPage.page);
    if (handler.notFoundPage) imports.push(handler.notFoundPage.page);
    for (const g of Object.values(handler.groups)) {
        imports.push(g.page);
        if (g.loadingPage) imports.push(g.loadingPage);
        if (g.errorPage) imports.push(g.errorPage);
    }
    await Promise.all(imports.map((i) => loadModule(i)));
};
