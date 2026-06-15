import { describe, it, expect } from 'vitest';
import { buildLoadingSwapScript } from '../utils/loading-swap';
import { createBaseMeta } from '../utils/html';

describe('buildLoadingSwapScript', () => {
    const meta = createBaseMeta();
    const assetsHtml = '<link rel="stylesheet" href="/_build/app.css">';

    it('produces a single inline <script> with the swap IIFE', () => {
        const script = buildLoadingSwapScript(meta, assetsHtml);
        expect(script).toContain('<script');
        expect(script).toContain('</script>');
        expect(script).toContain('(function () {');
        // Core behaviors the swap relies on.
        expect(script).toContain('__page_html__');
        expect(script).toContain('data-hydration="loading"');
        expect(script).toContain('replaceChildren');
        expect(script).toContain('document.title');
    });

    it('stamps the CSP nonce on the script tag when provided', () => {
        const script = buildLoadingSwapScript(meta, assetsHtml, 'nonce-123');
        expect(script).toContain('<script nonce="nonce-123">');
    });

    it('omits the nonce attribute when none is provided', () => {
        const script = buildLoadingSwapScript(meta, assetsHtml);
        expect(script).not.toContain('nonce=');
        // The script tag is still emitted, just without the attribute.
        expect(script).toMatch(/<script\s*>/);
    });

    it('embeds the merged head + assets as an escaped JSON string', () => {
        const script = buildLoadingSwapScript(meta, assetsHtml, 'n');
        // The stylesheet href is carried inside the serialized template html.
        expect(script).toContain('tpl.innerHTML =');
        expect(script).toContain('/_build/app.css');
    });
});
