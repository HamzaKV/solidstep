import { describe, it, expect, vi } from 'vitest';

// `generateHydrationScript` requires Solid's SSR runtime context, which isn't
// present in a bare unit test — mock just that export (keeping the rest of
// `solid-js/web`) so the nonce-stamping wrapper is exercised.
vi.mock('solid-js/web', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
        ...actual,
        generateHydrationScript: () => '<script>/*hydration*/</script>',
    };
});

import {
    serializeAttributes,
    generateHtmlHead,
    renderAssetsToHtml,
    serializeForScript,
    jsonForScript,
    hydrationScript,
    buildHydrationScript,
    buildHeadHtml,
    createBaseMeta,
} from '../utils/html';
import type { Meta } from '../utils/meta';

describe('serializeAttributes', () => {
    it('renders escaped key="value" pairs', () => {
        expect(serializeAttributes({ name: 'desc', content: 'a"b' })).toBe(
            'name="desc" content="a&quot;b"',
        );
    });
});

describe('generateHtmlHead', () => {
    it('renders each tag type and escapes values', () => {
        const meta: Meta = {
            title: { type: 'title', attributes: {}, content: 'A <b>' },
            description: {
                type: 'meta',
                attributes: { name: 'description', content: 'hi "x"' },
            },
            css: {
                type: 'link',
                attributes: { rel: 'stylesheet', href: '/a' },
            },
            inline: { type: 'style', attributes: { id: 's' } },
            js: { type: 'script', attributes: { src: '/a.js' } },
        };
        const html = generateHtmlHead(meta);
        expect(html).toContain('<title>A &lt;b&gt;</title>');
        expect(html).toContain(
            '<meta name="description" content="hi &quot;x&quot;">',
        );
        expect(html).toContain('<link rel="stylesheet" href="/a"></link>');
        expect(html).toContain('<style id="s"></style>');
        expect(html).toContain('<script src="/a.js"></script>');
    });

    it('handles a title with no content and an unknown tag type', () => {
        const meta = {
            title: { type: 'title', attributes: {} },
            weird: { type: 'weird', attributes: {} },
        } as unknown as Meta;
        expect(generateHtmlHead(meta)).toBe('<title></title>\n');
    });
});

describe('renderAssetsToHtml', () => {
    const assets = [
        { tag: 'script', attrs: { src: '/x.js' } },
        { tag: 'link', attrs: { rel: 'modulepreload', href: '/y.js' } },
        { tag: 'style', attrs: { id: 'z' }, children: 'a<b' },
        { tag: 'meta', attrs: { name: 'ignored' } },
    ];

    it('renders script/link/style and escapes style children; drops unknown tags', () => {
        const out = renderAssetsToHtml(assets, 'NONCE');
        expect(out).toContain('<script src="/x.js" nonce="NONCE"></script>');
        expect(out).toContain('<link rel="modulepreload" href="/y.js">');
        expect(out).toContain('<style id="z">a&lt;b</style>');
        // the meta asset (unknown tag) contributes an empty string
        expect(out).not.toContain('ignored');
    });

    it('omits the nonce when none is given', () => {
        expect(renderAssetsToHtml([{ tag: 'script', attrs: {} }])).toBe(
            '<script  ></script>',
        );
    });

    it('omits <script> tags when includeScripts is false', () => {
        const out = renderAssetsToHtml(assets, undefined, false);
        expect(out).not.toContain('<script');
        expect(out).toContain('<link');
        expect(out).toContain('<style');
    });

    it('renders a style with no children', () => {
        expect(renderAssetsToHtml([{ tag: 'style', attrs: {} }])).toBe(
            '<style ></style>',
        );
    });

    it('dedupes identical assets (e.g. when a page and its layout are both deferred and both pull in the same loading.tsx/error.tsx bundle)', () => {
        const dup = {
            tag: 'link',
            attrs: { rel: 'modulepreload', href: '/loading.js' },
        };
        const out = renderAssetsToHtml([dup, dup]);
        expect(out.split('/loading.js').length - 1).toBe(1);
    });

    it('keeps two link assets with the same href but different rel', () => {
        const out = renderAssetsToHtml([
            { tag: 'link', attrs: { rel: 'modulepreload', href: '/x.js' } },
            { tag: 'link', attrs: { rel: 'preload', href: '/x.js' } },
        ]);
        expect(out.split('<link').length - 1).toBe(2);
    });

    it('keeps two style assets with identical attrs but different children', () => {
        const out = renderAssetsToHtml([
            { tag: 'style', attrs: { id: 's' }, children: 'a{color:red}' },
            { tag: 'style', attrs: { id: 's' }, children: 'b{color:blue}' },
        ]);
        expect(out).toContain('a{color:red}');
        expect(out).toContain('b{color:blue}');
    });

    it('dedupes script assets by tag+src, ignoring nonce differences at render time', () => {
        const dup = { tag: 'script', attrs: { src: '/main.js' } };
        const out = renderAssetsToHtml([dup, dup], 'NONCE');
        expect(out.split('/main.js').length - 1).toBe(1);
    });
});

describe('serializeForScript', () => {
    it('emits a self-contained JS expression that reconstructs non-JSON values', () => {
        const out = serializeForScript({
            when: new Date(0),
            tags: new Map([['a', 1]]),
        });
        expect(out).toContain('new Date');
        expect(out).toContain('new Map');
    });
});

describe('jsonForScript', () => {
    it('escapes script-breakout characters', () => {
        const out = jsonForScript({ x: '</script>' });
        expect(out).not.toContain('</script>');
        expect(out).toContain('\\u003c');
    });
});

describe('hydrationScript', () => {
    it('returns Solid hydration markup, optionally with a nonce', () => {
        expect(hydrationScript({})).toContain('<script');
        expect(hydrationScript({ nonce: 'N' })).toContain('nonce="N"');
    });
});

describe('buildHydrationScript', () => {
    const base = {
        entryPath: '/_build/main.js',
        manifestPath: '/route/about',
        params: { id: '1' },
        searchParams: { q: 'x' },
        loaderData: { msg: 'hi' },
    };

    it('builds a module script calling main(...) with the route args', () => {
        const out = buildHydrationScript(base);
        expect(out).toContain('<script type="module">');
        expect(out).toContain("import main from '/_build/main.js'");
        expect(out).toContain('main("/route/about"');
        expect(out).toContain('{"id":"1"}');
        expect(out).toContain('{"q":"x"}');
    });

    it('appends extraArgs and adds nonce + data-hydration attributes', () => {
        const out = buildHydrationScript({
            ...base,
            extraArgs: ['["a"]', 'true'],
            nonce: 'N',
            dataHydration: 'loading',
        });
        expect(out).toContain('data-hydration="loading"');
        expect(out).toContain('nonce="N"');
        expect(out.endsWith('["a"],true);</script>')).toBe(true);
    });

    it('emits a fetchpriority attribute when fetchPriority is set', () => {
        const out = buildHydrationScript({ ...base, fetchPriority: 'high' });
        expect(out).toContain('fetchpriority="high"');
    });

    it('omits fetchpriority when not set', () => {
        const out = buildHydrationScript(base);
        expect(out).not.toContain('fetchpriority');
    });
});

describe('buildHeadHtml', () => {
    it('composes head metadata + assets + hydration script', () => {
        const meta: Meta = {
            title: { type: 'title', attributes: {}, content: 'T' },
        };
        const out = buildHeadHtml(meta, '<link href="/a">', 'N');
        expect(out).toContain('<title>T</title>');
        expect(out).toContain('<link href="/a">');
        expect(out).toContain('nonce="N"'); // from the hydration script
    });

    it('omits the Solid hydration script when hydrate is false', () => {
        const meta: Meta = {
            title: { type: 'title', attributes: {}, content: 'T' },
        };
        const out = buildHeadHtml(meta, '<link href="/a">', 'N', false);
        expect(out).toContain('<title>T</title>');
        expect(out).not.toContain('/*hydration*/');
    });
});

describe('createBaseMeta', () => {
    it('returns the base document meta with a fresh build_time each call', () => {
        const m = createBaseMeta();
        expect(m.charset.attributes.charset).toBe('UTF-8');
        expect(m.viewport.attributes.name).toBe('viewport');
        expect(m.title.content).toBe('SolidStep');
        expect(m.build_time.attributes.name).toBe('x-build-time');
        // A distinct object each call (so responses don't share a build_time ref).
        expect(createBaseMeta()).not.toBe(m);
    });
});
