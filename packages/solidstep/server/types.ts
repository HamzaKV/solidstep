import type { Component } from 'solid-js';
import type { getManifest } from 'vinxi/manifest';
import type { Meta, MetaFunction } from '../utils/meta';
import type { Options } from '../utils/options';
import type { Import, SearchParams } from '../utils/path-router';
import type { GenerateStaticParams } from '../utils/prerender';

/** The vinxi client/server manifest object (`getManifest(...)`). */
type VinxiManifest = ReturnType<typeof getManifest>;

/**
 * A page/layout/group component as referenced through a lazy {@link Import}.
 * Components receive route props (params, search, loader data, slots, locals)
 * and return a Solid view; the exact prop shape varies per node, so props are
 * kept deliberately loose (the render pipeline passes the props it assembled).
 */
export type ComponentFn = Component<any>;

/**
 * The `{ loader, options }` wrapper produced by `defineLoader` (server side).
 * `loader` resolves to `{ data }`; `options.type` drives the deferred/sequential
 * execution strategy and `options.cache` drives loader-data caching. Compatible
 * with the `CacheableLoader` consumed by `getCachedLoaderData`/`runSequentialLoader`.
 */
export type LoaderFn = {
    loader: (request?: Request) => Promise<{ data: unknown }>;
    options?: {
        type?: 'defer' | 'sequential';
        cache?: { ttl?: number; key?: string; swr?: number; tags?: string[] };
    };
};

/** Dynamically-imported module exporting a route `loader` (via `defineLoader`). */
export type LoaderModule = { loader?: LoaderFn };

/** Dynamically-imported page/layout/boundary module: its default-exported component. */
export type PageModule = { default: ComponentFn };

/** Dynamically-imported module exporting a `generateMeta` resolver. */
export type MetaModule = { generateMeta?: MetaFunction };

/** Dynamically-imported module exporting route `options`. */
export type OptionsModule = { options?: Options };

/** A single method handler exported from an API `route.ts` module. */
export type RouteMethodHandler = (
    req: Request,
    ctx: {
        params: Record<string, string | string[]>;
        searchParams: SearchParams;
    },
) => unknown | Promise<unknown>;

/**
 * Dynamically-imported API `route.ts` module: HTTP-method-keyed handlers
 * (`GET`, `POST`, …). Other exports may be present, hence the index signature.
 */
export type RouteApiModule = Record<string, RouteMethodHandler | unknown>;

/** Dynamically-imported module exporting `generateStaticParams`. */
export type GenerateStaticParamsModule = {
    generateStaticParams?: GenerateStaticParams;
};

/**
 * The page-variant node selected for a given `toRender` (main page, or a
 * loading/error/not-found boundary). They share `manifestPath`/`page`/
 * `generateMeta`; only the main page additionally carries a `loader` (and
 * `options`/`generateStaticParams`), so those are optional here.
 */
export type PageVariantNode = {
    manifestPath: string;
    page: Import;
    generateMeta?: Import;
    loader?: Import;
};

/**
 * A client-asset descriptor collected from the Vite/vinxi manifest for a render
 * (a `<script>`/`<link>`/`<style>` tag). Derived from vinxi's own manifest type
 * so it stays in sync with `clientManifest.inputs[...].assets()`.
 */
export type RenderAsset = Awaited<
    ReturnType<VinxiManifest['inputs'][string]['assets']>
>[number];

/**
 * Discriminated union returned by {@link import('./render').render}. The three
 * shapes are distinguished structurally (no runtime `kind` field is added, so
 * emitted output is unchanged): callers narrow with the `in` operator —
 * `'composed' in result` (streaming/deferred) and `'pprHoles' in result` (PPR
 * shell) — falling through to the plain/cached shape otherwise.
 */
export type RenderResult =
    | RenderPlainResult
    | RenderDeferredResult
    | RenderPprResult;

/** Plain (or page-cached) render: fully-rendered HTML string. */
export type RenderPlainResult = {
    rendered: string;
    documentMeta: Meta;
    documentAssets: RenderAsset[];
    loaderData: Record<string, unknown>;
    /**
     * Whether this plain result came from the page-render cache (`'hit'`) or was
     * rendered fresh (`'miss'`). Surfaced to request metrics; `undefined` when the
     * page does not opt into page caching.
     */
    cacheStatus?: 'hit' | 'miss';
};

/** Deferred (streaming) render: the composed tree is streamed by the caller. */
export type RenderDeferredResult = {
    deferred: true;
    composed: () => unknown;
    documentMeta: Meta;
    documentAssets: RenderAsset[];
    loaderData: Record<string, unknown>;
    deferredKeys: string[];
};

/** PPR shell render: static shell HTML plus the manifest paths of dynamic holes. */
export type RenderPprResult = {
    rendered: string;
    documentMeta: Meta;
    documentAssets: RenderAsset[];
    loaderData: Record<string, unknown>;
    pprHoles: string[];
};

/** Narrow a {@link RenderResult} to the deferred/streaming shape. */
export const isDeferredResult = (
    result: RenderResult,
): result is RenderDeferredResult => 'composed' in result;

/** Narrow a {@link RenderResult} to the PPR shell shape. */
export const isPprResult = (result: RenderResult): result is RenderPprResult =>
    'pprHoles' in result;
