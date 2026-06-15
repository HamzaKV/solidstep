import { escapeScript } from './escape';
import { generateHtmlHead } from './html';
import type { Meta } from './meta';

/**
 * Build the inline `<script>` that swaps a streamed `loading.tsx` shell for the
 * real page once the main content is ready, **without wiping `<head>`**.
 *
 * Wiping `head.innerHTML` (then re-appending scripts) drops/reorders head state
 * and is brittle under CSP and streamed assets. Instead this parses the new head
 * nodes (title/meta/link/style only — the caller passes `assetsHtml` built with
 * `renderAssetsToHtml(..., false)` so it omits scripts) and merges them in
 * explicitly, leaving every existing `<script>` (hydration/manifest) untouched.
 * It then removes the loading hydration script and replaces the document body
 * with the contents of the `<template id="__page_html__">` emitted just before.
 *
 * Extracted from `server.ts` so the swap logic is unit-testable in isolation.
 *
 * @param meta - The final page metadata (its `<head>` nodes are merged in).
 * @param assetsHtml - The page's asset `<link>`/`<style>` tags (no scripts).
 * @param nonce - CSP nonce to stamp on the inline `<script>`, when present.
 * @returns The `<script>…</script>` HTML to stream after the page `<template>`.
 */
export const buildLoadingSwapScript = (
    meta: Meta,
    assetsHtml: string,
    nonce?: string,
): string => `
<script ${nonce ? `nonce="${nonce}"` : ''}>
(function () {
    const head = document.head;
    const tpl = document.createElement('template');
    tpl.innerHTML = ${escapeScript(JSON.stringify(generateHtmlHead(meta) + assetsHtml))};
    const incoming = Array.from(tpl.content.childNodes);
    const metaKey = (el) =>
        el.getAttribute('charset') !== null
            ? 'charset'
            : el.getAttribute('name')
              ? 'name=' + el.getAttribute('name')
              : el.getAttribute('property')
                ? 'property=' + el.getAttribute('property')
                : el.getAttribute('http-equiv')
                  ? 'http-equiv=' + el.getAttribute('http-equiv')
                  : null;
    for (const node of incoming) {
        if (node.nodeType !== 1) continue;
        const tag = node.tagName;
        if (tag === 'TITLE') {
            document.title = node.textContent || '';
            continue;
        }
        if (tag === 'META') {
            const key = metaKey(node);
            const existing = key
                ? head.querySelector('meta[' + (key === 'charset' ? 'charset' : key.replace('=', '="') + '"') + ']')
                : null;
            if (existing) {
                existing.replaceWith(node);
            } else {
                head.appendChild(node);
            }
            continue;
        }
        if (tag === 'LINK') {
            const href = node.getAttribute('href');
            if (
                href &&
                head.querySelector('link[href="' + href.replace(/"/g, '\\\\"') + '"]')
            ) {
                continue;
            }
            head.appendChild(node);
            continue;
        }
        // <style> and any other head node: append.
        head.appendChild(node);
    }
    document
        .querySelector('script[data-hydration="loading"]')
        ?.remove();
    const template = document.getElementById('__page_html__');
    if (template) {
        const body = document.body;
        const next = document.createElement('template');
        next.innerHTML = template.innerHTML;
        body.replaceChildren(...next.content.childNodes);
        template.remove();
    }
})();
</script>
`;
