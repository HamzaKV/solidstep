/**
 * Radix-style route trie used by both the server and client routers.
 *
 * Routes are inserted by their clean URL path (e.g. `/blog/[slug]`) into a
 * {@link RouteNode} tree where each path segment is one of three kinds, ordered
 * by match priority: static (`blog`) → dynamic param (`[slug]`) → catch-all
 * (`[...rest]` / optional `[[...rest]]`). {@link matchRoute} walks the tree
 * segment-by-segment, trying static first, then param, then catch-all, so a
 * concrete route always wins over a more general one. Params collected during
 * the walk are returned alongside the matched handler.
 *
 * The trie is convention-agnostic: it stores arbitrary {@link RouteHandler}s,
 * which on the server are full page/api handlers and on the client are the
 * leaner {@link RouteNode}-compatible page handlers (see `client-manifest-core`).
 */

/** A lazy module reference: its `src` (manifest key) and an `import()` thunk. */
export type Import = {
    src: string;
    import: any;
};

/**
 * Everything the SSR render pipeline needs for a matched page route: the page
 * component plus its associated loader/meta/options/static-params imports, the
 * chain of enclosing `layout`s (root → leaf order), the optional
 * `loading`/`error`/`not-found` boundary pages, and any parallel-route `groups`
 * (slots) attached at this route. All component/loader references are lazy
 * {@link Import}s resolved on demand at render time.
 */
export type RoutePageHandler = {
    type: 'page';
    mainPage: {
        manifestPath: string;
        page: Import;
        loader?: Import;
        generateMeta?: Import;
        options?: Import;
        generateStaticParams?: Import;
    };
    loadingPage?: {
        manifestPath: string;
        page: Import;
        generateMeta?: Import;
    };
    errorPage?: {
        manifestPath: string;
        page: Import;
        generateMeta?: Import;
    };
    notFoundPage?: {
        manifestPath: string;
        page: Import;
        generateMeta?: Import;
    };
    layouts: {
        manifestPath: string;
        layout: Import;
        loader?: Import;
        generateMeta?: Import;
    }[];
    groups?: {
        [key: string]: {
            manifestPath: string;
            page: Import;
            loader?: Import;
            loadingPage?: Import;
            errorPage?: Import;
        };
    };
};

/**
 * A leaf payload stored on a {@link RouteNode}: either an API `route` (a single
 * `route.ts` handler module) or a {@link RoutePageHandler} for a page route.
 */
export type RouteHandler =
    | {
          type: 'route';
          handler: Import;
          manifestPath: string;
      }
    | RoutePageHandler;

/** Matched route params: a single value for `[id]`, an array for catch-alls. */
type Params = Record<string, string | string[]>;

/**
 * Parsed query string: a single value per key, or an array when a key repeats
 * (`?tag=a&tag=b` → `{ tag: ['a', 'b'] }`). Mirrors the route-param shape and
 * matches Next.js's `searchParams`.
 */
export type SearchParams = Record<string, string | string[]>;

/**
 * Convert a {@link URLSearchParams} into a plain object, preserving repeated
 * keys as arrays. `Object.fromEntries(searchParams)` silently keeps only the
 * last value for a repeated key (`?tag=a&tag=b` → `{ tag: 'b' }`); this keeps
 * them all so multi-value filters survive into loaders, pages, and the
 * soft-navigation envelope.
 */
export const parseSearchParams = (sp: URLSearchParams): SearchParams => {
    const out: SearchParams = {};
    for (const [key, value] of sp) {
        const existing = out[key];
        if (existing === undefined) {
            out[key] = value;
        } else if (Array.isArray(existing)) {
            existing.push(value);
        } else {
            out[key] = [existing, value];
        }
    }
    return out;
};

/**
 * A node in the route trie. Each node has at most three kinds of children,
 * matched in priority order by {@link matchRoute}:
 *
 * - `staticChildren` — literal segments keyed by their exact value (highest
 *   priority); a node may have many.
 * - `paramChild` — the single `[name]` dynamic segment, if any; binds one
 *   segment to `name`.
 * - `catchAllChild` — the single `[...name]` / `[[...name]]` segment, if any;
 *   binds the remaining segments to `name`. `optional` marks `[[...name]]`,
 *   which can also match zero remaining segments.
 *
 * `handler` is the route payload terminating at this node (a node may be a pure
 * intermediate with no handler).
 */
export type RouteNode = {
    staticChildren: Map<string, RouteNode>;

    paramChild?: {
        name: string;
        node: RouteNode;
    };

    catchAllChild?: {
        name: string;
        optional: boolean;
        node: RouteNode;
    };

    handler?: RouteHandler;
};

/** Create an empty trie node (used both for the root and for each child). */
export const createNode = (): RouteNode => ({
    staticChildren: new Map(),
});

type ParseSegment =
    | {
          type: 'static';
          value: string;
      }
    | {
          type: 'param';
          name: string;
      }
    | {
          type: 'catchAll';
          optional: true;
          name: string;
      }
    | {
          type: 'catchAll';
          optional: false;
          name: string;
      };

/**
 * Classify one raw path segment by its bracket convention: `[[...x]]` optional
 * catch-all, `[...x]` required catch-all, `[x]` dynamic param, or otherwise a
 * static literal. The param/catch-all `name` strips the surrounding brackets.
 */
const parseSegment = (segment: string): ParseSegment => {
    // [[...slug]]
    if (segment.startsWith('[[...') && segment.endsWith(']]')) {
        return { type: 'catchAll', name: segment.slice(5, -2), optional: true };
    }

    // [...slug]
    if (segment.startsWith('[...') && segment.endsWith(']')) {
        return {
            type: 'catchAll',
            name: segment.slice(4, -1),
            optional: false,
        };
    }

    // [id]
    if (segment.startsWith('[') && segment.endsWith(']')) {
        return { type: 'param', name: segment.slice(1, -1) };
    }

    return { type: 'static', value: segment };
};

/**
 * Insert `handler` at `path` into the trie, creating intermediate nodes as
 * needed. The path is split on `/` (empty segments dropped) and each segment is
 * classified by {@link parseSegment}; static segments key into
 * `staticChildren`, a `[param]` reuses/creates the node's single `paramChild`,
 * and a catch-all reuses/creates `catchAllChild` and then stops (a catch-all
 * always consumes the rest of the path). Inserting two routes whose segments
 * differ only by the param/catch-all *name* reuses the existing child node, so
 * the first inserted name wins. The handler is assigned to the terminal node.
 *
 * @param root - The trie root (from {@link createNode}).
 * @param path - Clean route path, e.g. `/blog/[slug]` or `/docs/[...path]`.
 * @param handler - The payload to store at the terminal node.
 */
export const insertRoute = (
    root: RouteNode,
    path: string,
    handler: RouteHandler,
) => {
    const segments = path.split('/').filter(Boolean);
    let node = root;

    for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        const parsed = parseSegment(segment);

        if (parsed.type === 'static' && parsed.value) {
            if (!node.staticChildren.has(parsed.value)) {
                node.staticChildren.set(parsed.value, createNode());
            }
            node = node.staticChildren.get(parsed.value)!;
            continue;
        }

        if (parsed.type === 'param') {
            if (!node.paramChild) {
                node.paramChild = {
                    name: parsed.name,
                    node: createNode(),
                };
            }
            node = node.paramChild.node;
            continue;
        }

        // Only catchAll segments reach here — static and param both continue above
        const catchAll = parsed as Extract<ParseSegment, { type: 'catchAll' }>;
        if (i !== segments.length - 1) {
            throw new Error(
                `Invalid route "${path}": a catch-all segment ("${segment}") must be the last segment. ` +
                    `"${segments.slice(i + 1).join('/')}" would never be reachable -- move it out of the catch-all folder.`,
            );
        }
        if (!node.catchAllChild) {
            node.catchAllChild = {
                name: catchAll.name,
                optional: catchAll.optional,
                node: createNode(),
            };
        }
        node = node.catchAllChild.node;
        break; // catch-all always consumes the rest
    }

    node.handler = handler;
};

/** The matched handler plus the params bound while walking, or `null` on no match. */
type MatchResult = {
    handler: RouteHandler;
    params: Params;
} | null;

/**
 * Match a pathname against the trie, returning the terminal handler and the
 * params collected along the way. The recursive walk tries children in strict
 * priority order at each segment — static, then param, then catch-all — and
 * backtracks (undoing a tentatively-bound param) if a deeper branch dead-ends,
 * so a fully-static path always beats a param/catch-all alternative. An
 * optional catch-all (`[[...x]]`) can satisfy the end of the path with an empty
 * array when no other handler terminates there.
 *
 * @param root - The trie root.
 * @param path - The request pathname (leading/trailing/empty segments ignored).
 * @returns The {@link MatchResult}, or `null` if nothing matches.
 */
// Malformed percent-encoding (e.g. a lone trailing `%`) throws in
// decodeURIComponent; pass the raw segment through rather than failing the
// whole match over one unparsable value.
const tryDecode = (segment: string): string => {
    try {
        return decodeURIComponent(segment);
    } catch {
        return segment;
    }
};

export const matchRoute = (root: RouteNode, path: string): MatchResult => {
    const segments = path.split('/').filter(Boolean);
    const params: Params = {};

    const walk = (node: RouteNode, index: number): RouteHandler | null => {
        // End of path
        if (index === segments.length) {
            if (node.handler) return node.handler;

            // Optional catch-all can match empty
            if (node.catchAllChild?.optional) {
                params[node.catchAllChild.name] = [];
                return node.catchAllChild.node.handler ?? null;
            }

            return null;
        }

        const segment = segments[index];

        // 1. Static
        const staticChild = node.staticChildren.get(segment);
        if (staticChild) {
            const res = walk(staticChild, index + 1);
            if (res) return res;
        }

        // 2. Param
        if (node.paramChild) {
            params[node.paramChild.name] = tryDecode(segment);
            const res = walk(node.paramChild.node, index + 1);
            if (res) return res;
            delete params[node.paramChild.name];
        }

        // 3. Catch-all
        if (node.catchAllChild) {
            params[node.catchAllChild.name] = segments
                .slice(index)
                .map(tryDecode);
            return node.catchAllChild.node.handler ?? null;
        }

        return null;
    };

    const handler = walk(root, 0);
    if (!handler) return null;

    return { handler, params };
};
