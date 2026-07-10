// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { buildLoadingSwapScript } from '../utils/loading-swap';
import type { Meta } from '../utils/meta';

// Execute the generated swap IIFE against a real (jsdom) document — the
// string-shape tests in loading-swap.test.ts don't run the script, so
// selector-construction bugs only surface here.

const runSwap = (meta: Meta, assetsHtml = '') => {
    const script = buildLoadingSwapScript(meta, assetsHtml);
    const code = script.replace(/<\/?script[^>]*>/g, '');
    new Function(code)();
};

beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    sessionStorage.clear();
});

describe('loading-swap script execution', () => {
    it('replaces an existing meta by name', () => {
        document.head.innerHTML = '<meta name="description" content="old">';
        runSwap({
            description: {
                type: 'meta',
                attributes: { name: 'description', content: 'new' },
            },
        } as Meta);
        const el = document.head.querySelector('meta[name="description"]');
        expect(el?.getAttribute('content')).toBe('new');
        expect(
            document.head.querySelectorAll('meta[name="description"]'),
        ).toHaveLength(1);
    });

    it('survives a meta name containing a quote (selector must be escaped)', () => {
        const name = 'we"ird';
        const existing = document.createElement('meta');
        existing.setAttribute('name', name);
        existing.setAttribute('content', 'v1');
        document.head.appendChild(existing);

        runSwap({
            weird: {
                type: 'meta',
                attributes: { name, content: 'v2' },
            },
        } as Meta);

        // An unescaped selector throws inside the swap -> caught -> reload
        // fallback -> the meta never updates. With escaping it's replaced.
        const el = document.head.querySelector(
            `meta[name=${CSS.escape(name)}]`,
        );
        expect(el?.getAttribute('content')).toBe('v2');
    });

    it('survives a link href containing a backslash without duplicating or crashing', () => {
        const href = '/weird\\path.css';
        const existing = document.createElement('link');
        existing.setAttribute('rel', 'stylesheet');
        existing.setAttribute('href', href);
        document.head.appendChild(existing);

        runSwap(
            {} as Meta,
            `<link rel="stylesheet" href="${href.replace(/\\/g, '\\')}">`,
        );

        // Deduped (not appended twice), and no selector crash aborted the swap.
        expect(
            document.head.querySelectorAll('link[rel="stylesheet"]'),
        ).toHaveLength(1);
    });
});
