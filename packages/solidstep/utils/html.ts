import { generateHydrationScript } from 'solid-js/web';
import { serialize } from 'seroval';
import { escapeHtml, escapeScript } from './escape.js';
import { SEROVAL_PLUGINS } from './serialize.js';
import type { Meta } from './meta.js';
import type { SearchParams } from './path-router.js';

/**
 * Pure HTML/inline-script generation for the SSR document. Extracted from
 * `server.ts` so it is unit-testable and reused across every render branch
 * (main / loading / error / not-found / PPR / deferred-stream). All dynamic
 * values are escaped for their context (`escapeHtml` for HTML, `escapeScript` /
 * seroval `serialize` for inline `<script>`).
 */

/**
 * Serialize an attribute bag to a `key="value"` string with HTML-escaped values
 * so an attribute value can never break out of its quotes.
 */
export const serializeAttributes = (
    attributes: Record<string, unknown>,
): string =>
    Object.entries(attributes)
        .map(
            ([attrKey, attrValue]) =>
                `${attrKey}="${escapeHtml(String(attrValue))}"`,
        )
        .join(' ');

/** Render a route's {@link Meta} into `<title>`/`<meta>`/`<link>`/… head tags. */
export const generateHtmlHead = (meta: Meta): string =>
    Object.entries(meta)
        .map(([_key, value]) => {
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

/**
 * Render the per-module client asset list (collected from the Vite manifest)
 * into `<script>`/`<link>`/`<style>` tags. Attribute values and inline style
 * content are HTML-escaped, and script tags carry the CSP nonce when present.
 *
 * @param includeScripts - The loading head-swap re-appends existing `<script>`
 *   elements itself, so it asks for link/style only to avoid duplicating scripts.
 */
/**
 * Dedupe identical assets, keeping the first occurrence's order. Deferred
 * page and layout loaders each independently resolve the route's
 * `loading.tsx`/`error.tsx` assets (see `server/render.ts`), so a route with
 * more than one deferred boundary would otherwise emit the same
 * `<link>`/`<script>` tag once per boundary.
 */
const dedupeKey = (asset: {
    tag: string;
    attrs: Record<string, unknown>;
    children?: string;
}): string => {
    // script/link assets are uniquely identified by tag + rel + src/href, which
    // covers the vast majority of assets and avoids a full JSON.stringify per
    // asset per render. Anything else (inline <style>, or a script/link with
    // neither src nor href) falls back to the exact-match comparison.
    const ref = asset.attrs.src ?? asset.attrs.href;
    if (asset.children === undefined && typeof ref === 'string') {
        return `${asset.tag}|${asset.attrs.rel ?? ''}|${ref}`;
    }
    return JSON.stringify(asset);
};

const dedupeAssets = <
    T extends {
        tag: string;
        attrs: Record<string, unknown>;
        children?: string;
    },
>(
    assets: T[],
): T[] => {
    const seen = new Set<string>();
    return assets.filter((asset) => {
        const key = dedupeKey(asset);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};

export const renderAssetsToHtml = (
    assets: {
        tag: string;
        attrs: Record<string, unknown>;
        children?: string;
    }[],
    cspNonce?: string,
    includeScripts = true,
): string =>
    dedupeAssets(assets)
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

/**
 * Serialize a fully-resolved value (loader data) into a self-contained JS
 * expression for embedding inside an inline `<script>`. seroval reconstructs
 * non-JSON values (Date/Map/Set/BigInt) on the client — matching the
 * server-action transport — and already escapes `<` (to `\x3C`) plus the JS line
 * terminators inside its string literals, so its output is script-safe as
 * emitted. It must NOT be passed through `escapeScript`: the expression contains
 * operators (e.g. an arrow-function wrapper) outside string literals that
 * escaping would corrupt.
 */
export const serializeForScript = (value: unknown): string =>
    serialize(value, { plugins: SEROVAL_PLUGINS });

/**
 * Plain JSON payload (params/searchParams are strings or string arrays) escaped
 * for safe inline-script embedding.
 */
export const jsonForScript = (value: unknown): string =>
    escapeScript(JSON.stringify(value));

/** Solid's hydration `<script>`, stamped with the CSP nonce when present. */
export const hydrationScript = ({ nonce }: { nonce?: string }): string => {
    const script = generateHydrationScript();
    return nonce
        ? script.replace('<script', `<script nonce="${nonce}"`)
        : script;
};

/**
 * Build the client-entry hydration `<script>` that calls
 * `main(manifestPath, params, searchParams, loaderData, ...extraArgs)`. Used by
 * every render branch; `extraArgs` are already-serialized JS argument strings
 * appended after `loaderData` (e.g. `[jsonForScript(deferredKeys)]`, or for PPR
 * `[jsonForScript(pprHoles), 'true']`).
 */
export const buildHydrationScript = (opts: {
    entryPath: string;
    manifestPath: string;
    params: Record<string, string | string[]>;
    searchParams: SearchParams;
    loaderData: unknown;
    extraArgs?: string[];
    nonce?: string;
    dataHydration?: string;
    fetchPriority?: 'high' | 'low' | 'auto';
}): string => {
    const args = [
        jsonForScript(opts.manifestPath),
        jsonForScript(opts.params),
        jsonForScript(opts.searchParams),
        serializeForScript(opts.loaderData),
        ...(opts.extraArgs ?? []),
    ].join(',');
    const attrs = [
        'type="module"',
        opts.dataHydration ? `data-hydration="${opts.dataHydration}"` : '',
        opts.nonce ? `nonce="${opts.nonce}"` : '',
        opts.fetchPriority ? `fetchpriority="${opts.fetchPriority}"` : '',
    ]
        .filter(Boolean)
        .join(' ');
    return `<script ${attrs}>import main from '${opts.entryPath}';main(${args});</script>`;
};

/**
 * Compose the `<head>` inner HTML: metadata + asset tags + Solid's hydration
 * script. Pass `hydrate: false` to omit the hydration script entirely (a
 * route with `hydration.disable` ships no framework JS).
 */
export const buildHeadHtml = (
    meta: Meta,
    assetsHtml: string,
    nonce?: string,
    hydrate = true,
): string =>
    `${generateHtmlHead(meta)}\n${assetsHtml}${hydrate ? `\n${hydrationScript({ nonce })}` : ''}`;

/**
 * The base document {@link Meta} (charset, viewport, default title, build-time
 * marker). Returns a fresh object per call so each response stamps its own
 * `build_time`.
 */
export const createBaseMeta = (): Meta => ({
    charset: {
        type: 'meta',
        attributes: { charset: 'UTF-8' },
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
});
