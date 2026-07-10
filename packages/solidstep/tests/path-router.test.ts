import { describe, it, expect, beforeEach } from 'vitest';
import {
    createNode,
    insertRoute,
    matchRoute,
    parseSearchParams,
    type RouteNode,
    type RouteHandler,
} from '../utils/path-router';

const makePageHandler = (id: string): RouteHandler => ({
    type: 'page',
    mainPage: {
        manifestPath: id,
        page: { src: id, import: async () => ({}) },
    },
    layouts: [],
});

const makeRouteHandler = (id: string): RouteHandler => ({
    type: 'route',
    manifestPath: id,
    handler: { src: id, import: async () => ({}) },
});

let root: RouteNode;

beforeEach(() => {
    root = createNode();
});

describe('static routes', () => {
    it('matches root /', () => {
        const h = makePageHandler('/');
        insertRoute(root, '/', h);
        const result = matchRoute(root, '/');
        expect(result).not.toBeNull();
        expect(result!.handler).toBe(h);
        expect(result!.params).toEqual({});
    });

    it('matches a single segment', () => {
        const h = makePageHandler('/about');
        insertRoute(root, '/about', h);
        expect(matchRoute(root, '/about')!.handler).toBe(h);
    });

    it('matches nested segments', () => {
        const h = makePageHandler('/blog/archive');
        insertRoute(root, '/blog/archive', h);
        expect(matchRoute(root, '/blog/archive')!.handler).toBe(h);
    });

    it('returns null for unknown path', () => {
        insertRoute(root, '/about', makePageHandler('/about'));
        expect(matchRoute(root, '/missing')).toBeNull();
    });

    it('does not match partial prefix', () => {
        insertRoute(root, '/about', makePageHandler('/about'));
        expect(matchRoute(root, '/about/extra')).toBeNull();
    });

    it('matches multiple independent routes', () => {
        const h1 = makePageHandler('/a');
        const h2 = makePageHandler('/b');
        insertRoute(root, '/a', h1);
        insertRoute(root, '/b', h2);
        expect(matchRoute(root, '/a')!.handler).toBe(h1);
        expect(matchRoute(root, '/b')!.handler).toBe(h2);
    });
});

describe('param routes', () => {
    it('captures a single param', () => {
        const h = makePageHandler('/blog/[slug]');
        insertRoute(root, '/blog/[slug]', h);
        const result = matchRoute(root, '/blog/hello-world');
        expect(result).not.toBeNull();
        expect(result!.params).toEqual({ slug: 'hello-world' });
        expect(result!.handler).toBe(h);
    });

    it('captures multiple params', () => {
        const h = makePageHandler('/users/[id]/posts/[postId]');
        insertRoute(root, '/users/[id]/posts/[postId]', h);
        const result = matchRoute(root, '/users/42/posts/99');
        expect(result!.params).toEqual({ id: '42', postId: '99' });
    });

    it('does not match if param segment is missing', () => {
        insertRoute(root, '/blog/[slug]', makePageHandler('/blog/[slug]'));
        expect(matchRoute(root, '/blog')).toBeNull();
    });
});

describe('static takes priority over param', () => {
    it('prefers static over param for the same position', () => {
        const staticH = makePageHandler('/blog/new');
        const paramH = makePageHandler('/blog/[slug]');
        insertRoute(root, '/blog/new', staticH);
        insertRoute(root, '/blog/[slug]', paramH);
        expect(matchRoute(root, '/blog/new')!.handler).toBe(staticH);
        expect(matchRoute(root, '/blog/anything-else')!.handler).toBe(paramH);
    });

    it('backtracks from failed param branch and falls through to catch-all', () => {
        // /[id]/fixed — param + required static continuation
        // /[...rest]  — catch-all at root
        const fixedH = makePageHandler('/[id]/fixed');
        const catchAllH = makePageHandler('/[...rest]');
        insertRoute(root, '/[id]/fixed', fixedH);
        insertRoute(root, '/[...rest]', catchAllH);

        // '/42/other': tries param id=42, then looks for 'fixed' under that node,
        // finds 'other' instead → sub-walk returns null → deletes id param → falls
        // through to catch-all which captures ['42', 'other']
        const result = matchRoute(root, '/42/other');
        expect(result).not.toBeNull();
        expect(result!.handler).toBe(catchAllH);
        expect(result!.params).toEqual({ rest: ['42', 'other'] });
        // id param must not leak into result
        expect(result!.params.id).toBeUndefined();
    });
});

describe('catch-all routes', () => {
    it('captures multiple segments', () => {
        const h = makePageHandler('/docs/[...path]');
        insertRoute(root, '/docs/[...path]', h);
        const result = matchRoute(root, '/docs/a/b/c');
        expect(result).not.toBeNull();
        expect(result!.params).toEqual({ path: ['a', 'b', 'c'] });
    });

    it('returns null when the required catch-all node has no handler', () => {
        // Construct tree manually to exercise the ?? null null-branch
        root.catchAllChild = {
            name: 'path',
            optional: false,
            node: createNode(),
        };
        expect(matchRoute(root, '/a/b')).toBeNull();
    });

    it('captures a single segment', () => {
        const h = makePageHandler('/docs/[...path]');
        insertRoute(root, '/docs/[...path]', h);
        expect(matchRoute(root, '/docs/intro')!.params).toEqual({
            path: ['intro'],
        });
    });

    it('required catch-all does not match zero segments', () => {
        insertRoute(
            root,
            '/docs/[...path]',
            makePageHandler('/docs/[...path]'),
        );
        expect(matchRoute(root, '/docs')).toBeNull();
    });
});

describe('optional catch-all routes', () => {
    it('matches zero segments (base path)', () => {
        const h = makePageHandler('/docs/[[...path]]');
        insertRoute(root, '/docs/[[...path]]', h);
        const result = matchRoute(root, '/docs');
        expect(result).not.toBeNull();
        expect(result!.params).toEqual({ path: [] });
    });

    it('returns null when the optional catch-all node has no handler', () => {
        // Construct tree manually to exercise the ?? null null-branch
        root.catchAllChild = {
            name: 'path',
            optional: true,
            node: createNode(),
        };
        expect(matchRoute(root, '/')).toBeNull();
    });

    it('matches one segment', () => {
        const h = makePageHandler('/docs/[[...path]]');
        insertRoute(root, '/docs/[[...path]]', h);
        expect(matchRoute(root, '/docs/intro')!.params).toEqual({
            path: ['intro'],
        });
    });

    it('matches many segments', () => {
        const h = makePageHandler('/docs/[[...path]]');
        insertRoute(root, '/docs/[[...path]]', h);
        expect(matchRoute(root, '/docs/a/b/c')!.params).toEqual({
            path: ['a', 'b', 'c'],
        });
    });
});

describe('route type', () => {
    it('stores route type handlers correctly', () => {
        const h = makeRouteHandler('/api/users');
        insertRoute(root, '/api/users', h);
        expect(matchRoute(root, '/api/users')!.handler.type).toBe('route');
    });
});

describe('insertRoute — reusing existing param and catch-all nodes', () => {
    it('reuses an existing paramChild node for sibling param routes', () => {
        // /[id]/a and /[id]/b share the same [id] paramChild node
        const hA = makePageHandler('/[id]/a');
        const hB = makePageHandler('/[id]/b');
        insertRoute(root, '/[id]/a', hA);
        insertRoute(root, '/[id]/b', hB); // hits the existing paramChild branch

        expect(matchRoute(root, '/42/a')!.handler).toBe(hA);
        expect(matchRoute(root, '/42/b')!.handler).toBe(hB);
        expect(matchRoute(root, '/42/a')!.params).toEqual({ id: '42' });
    });

    it('reuses an existing catchAllChild node when the same catch-all is inserted again', () => {
        const h1 = makePageHandler('/[...rest]');
        const h2 = makePageHandler('/[...rest] v2'); // will overwrite handler on same node
        insertRoute(root, '/[...rest]', h1);
        insertRoute(root, '/[...rest]', h2); // hits the existing catchAllChild branch

        // Handler is overwritten by the second insert
        expect(matchRoute(root, '/a/b')!.handler).toBe(h2);
    });
});

describe('robustness — collisions, depth, and group segments', () => {
    it('captures distinct values when the same param name repeats at different depths', () => {
        // Re-using `[id]` at two levels: the last write wins per segment, and
        // each position is captured independently into the same key.
        const h = makePageHandler('/[id]/posts/[id]');
        insertRoute(root, '/[id]/posts/[id]', h);
        const result = matchRoute(root, '/42/posts/99');
        expect(result!.handler).toBe(h);
        // Same key — the deeper segment overwrites the shallower one.
        expect(result!.params).toEqual({ id: '99' });
    });

    it('matches a deeply nested path mixing static, param, and catch-all segments', () => {
        const h = makePageHandler('/a/[b]/c/[d]/e/[...rest]');
        insertRoute(root, '/a/[b]/c/[d]/e/[...rest]', h);
        const result = matchRoute(root, '/a/1/c/2/e/x/y/z');
        expect(result!.handler).toBe(h);
        expect(result!.params).toEqual({
            b: '1',
            d: '2',
            rest: ['x', 'y', 'z'],
        });
    });

    it('treats an @-prefixed parallel-route slot as a plain static segment', () => {
        // Parallel-route groups are resolved by the router/server, not by
        // path-router — here `@graph` is just a static path segment.
        const h = makePageHandler('/dashboard/@graph');
        insertRoute(root, '/dashboard/@graph', h);
        expect(matchRoute(root, '/dashboard/@graph')!.handler).toBe(h);
        expect(matchRoute(root, '/dashboard/graph')).toBeNull();
    });
});

describe('insertRoute — segment after a catch-all', () => {
    // A catch-all always consumes the rest of the path (see insertRoute's
    // doc comment) -- a route nested under one, e.g.
    // `app/shop/[[...slug]]/checkout/page.tsx`, would otherwise silently
    // collide onto the same trie node as `app/shop/[[...slug]]/page.tsx`,
    // with whichever route is inserted last winning and the other becoming
    // permanently unreachable.
    it('throws for a static segment nested after a required catch-all', () => {
        expect(() =>
            insertRoute(
                root,
                '/docs/[...path]/extra',
                makePageHandler('/docs/[...path]/extra'),
            ),
        ).toThrow(/catch-all/i);
    });

    it('throws for a static segment nested after an optional catch-all', () => {
        expect(() =>
            insertRoute(
                root,
                '/shop/[[...slug]]/checkout',
                makePageHandler('/shop/[[...slug]]/checkout'),
            ),
        ).toThrow(/catch-all/i);
    });

    it('does not throw when the catch-all is the last segment', () => {
        expect(() =>
            insertRoute(
                root,
                '/docs/[...path]',
                makePageHandler('/docs/[...path]'),
            ),
        ).not.toThrow();
    });
});

describe('param/catch-all decoding', () => {
    it('decodes a percent-encoded param value (e.g. a space)', () => {
        insertRoute(root, '/blog/[slug]', makePageHandler('/blog/[slug]'));
        const result = matchRoute(root, '/blog/hello%20world');
        expect(result!.params).toEqual({ slug: 'hello world' });
    });

    it('decodes each segment of a catch-all', () => {
        insertRoute(
            root,
            '/docs/[...path]',
            makePageHandler('/docs/[...path]'),
        );
        const result = matchRoute(root, '/docs/a%2Fb/c%20d');
        expect(result!.params).toEqual({ path: ['a/b', 'c d'] });
    });

    it('passes a malformed percent-encoding through raw rather than throwing', () => {
        insertRoute(root, '/blog/[slug]', makePageHandler('/blog/[slug]'));
        const result = matchRoute(root, '/blog/100%');
        expect(result!.params).toEqual({ slug: '100%' });
    });

    it('still matches static segments by their raw (undecoded) form', () => {
        const h = makePageHandler('/blog/new');
        insertRoute(root, '/blog/new', h);
        expect(matchRoute(root, '/blog/new')!.handler).toBe(h);
        expect(matchRoute(root, '/blog/%6Ee%77')).toBeNull();
    });
});

describe('parseSearchParams', () => {
    const parse = (qs: string) =>
        parseSearchParams(new URL(`http://x/?${qs}`).searchParams);

    it('returns an empty object for no query string', () => {
        expect(parse('')).toEqual({});
    });

    it('keeps a single occurrence as a string', () => {
        expect(parse('q=hello&page=2')).toEqual({ q: 'hello', page: '2' });
    });

    it('collects a repeated key into an array (preserving order)', () => {
        expect(parse('tag=a&tag=b&tag=c')).toEqual({ tag: ['a', 'b', 'c'] });
    });

    it('mixes single and repeated keys in one object', () => {
        expect(parse('tag=a&tag=b&sort=asc')).toEqual({
            tag: ['a', 'b'],
            sort: 'asc',
        });
    });

    it('preserves an empty value for a present key', () => {
        expect(parse('flag=')).toEqual({ flag: '' });
    });
});
