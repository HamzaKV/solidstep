import { describe, it, expect } from 'vitest';
import {
    buildConcretePath,
    hasDynamicSegments,
    expandRoute,
    DEFAULT_REVALIDATE,
    type PatternSegment,
} from '../utils/prerender';

const s = (value: string): PatternSegment => ({ kind: 'static', value });
const p = (name: string): PatternSegment => ({ kind: 'param', name });
const c = (name: string, optional = false): PatternSegment => ({
    kind: 'catchAll',
    name,
    optional,
});

describe('buildConcretePath', () => {
    it('builds the root path from no segments', () => {
        expect(buildConcretePath([])).toBe('/');
    });

    it('joins static segments', () => {
        expect(buildConcretePath([s('blog'), s('latest')])).toBe('/blog/latest');
    });

    it('substitutes a string param', () => {
        expect(buildConcretePath([s('blog'), p('slug')], { slug: 'hi' })).toBe(
            '/blog/hi',
        );
    });

    it('expands a catch-all array into multiple segments', () => {
        expect(
            buildConcretePath([s('docs'), c('path')], { path: ['a', 'b', 'c'] }),
        ).toBe('/docs/a/b/c');
    });

    it('treats a non-array catch-all value as a single segment', () => {
        expect(buildConcretePath([c('path')], { path: 'solo' })).toBe('/solo');
    });

    it('collapses an optional catch-all with no value to the base path', () => {
        expect(buildConcretePath([s('shop'), c('path', true)])).toBe('/shop');
    });

    it('throws on a missing required param', () => {
        expect(() => buildConcretePath([p('slug')])).toThrow(
            'Missing param "slug"',
        );
    });

    it('throws on a missing required catch-all', () => {
        expect(() => buildConcretePath([c('path')])).toThrow(
            'Missing catch-all param "path"',
        );
    });
});

describe('hasDynamicSegments', () => {
    it('is false for all-static patterns', () => {
        expect(hasDynamicSegments([s('a'), s('b')])).toBe(false);
    });
    it('is true when a param or catch-all is present', () => {
        expect(hasDynamicSegments([s('a'), p('id')])).toBe(true);
        expect(hasDynamicSegments([c('rest', true)])).toBe(true);
    });
});

describe('expandRoute', () => {
    it('returns nothing for a dynamic (non-static/isr) route', () => {
        expect(expandRoute([s('about')], { render: 'dynamic' }, undefined)).toEqual(
            [],
        );
        expect(expandRoute([s('about')], undefined, undefined)).toEqual([]);
    });

    it('expands a non-dynamic static route to a single target', () => {
        expect(
            expandRoute([s('about')], { render: 'static' }, undefined),
        ).toEqual([{ pathname: '/about', render: 'static', revalidate: undefined, tags: undefined }]);
    });

    it('defaults the ISR revalidate interval and carries tags', () => {
        expect(
            expandRoute(
                [s('news')],
                { render: 'isr', cache: { tags: ['news'] } },
                undefined,
            ),
        ).toEqual([
            {
                pathname: '/news',
                render: 'isr',
                revalidate: DEFAULT_REVALIDATE,
                tags: ['news'],
            },
        ]);
    });

    it('honors an explicit ISR revalidate interval', () => {
        const [target] = expandRoute([s('news')], { render: 'isr', revalidate: 10 }, undefined);
        expect(target.revalidate).toBe(10);
    });

    it('treats a non-dynamic ppr route like static (shell artifact, no revalidate)', () => {
        expect(expandRoute([s('feed')], { render: 'ppr' }, undefined)).toEqual([
            {
                pathname: '/feed',
                render: 'ppr',
                revalidate: undefined,
                tags: undefined,
            },
        ]);
    });

    it('expands a dynamic ppr route across its static params', () => {
        const targets = expandRoute([s('u'), p('id')], { render: 'ppr' }, [
            { id: 'a' },
            { id: 'b' },
        ]);
        expect(targets.map((t) => `${t.render}:${t.pathname}`)).toEqual([
            'ppr:/u/a',
            'ppr:/u/b',
        ]);
    });

    it('expands a dynamic route across its static params', () => {
        const targets = expandRoute(
            [s('blog'), p('slug')],
            { render: 'static' },
            [{ slug: 'a' }, { slug: 'b' }],
        );
        expect(targets.map((t) => t.pathname)).toEqual(['/blog/a', '/blog/b']);
    });

    it('returns nothing for a dynamic route without static params', () => {
        expect(expandRoute([s('blog'), p('slug')], { render: 'static' }, [])).toEqual(
            [],
        );
        expect(
            expandRoute([s('blog'), p('slug')], { render: 'static' }, undefined),
        ).toEqual([]);
    });
});
