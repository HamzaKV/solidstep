
export type Import = {
    src: string;
    import: any;
};

export type RoutePageHandler = {
    type: 'page';
    mainPage: {
        manifestPath: string;
        page: Import;
        loader?: Import;
        generateMeta?: Import;
        options?: Import;
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
        };
    };
};

export type RouteHandler =
    | {
        type: 'route';
        handler: Import;
        manifestPath: string;
    }
    | RoutePageHandler;

type Params = Record<string, string | string[]>;

export type RouteNode = {
    staticChildren: Map<string, RouteNode>;

    paramChild?: {
        name: string;
        node: RouteNode;
    }

    catchAllChild?: {
        name: string;
        optional: boolean;
        node: RouteNode;
    }

    handler?: RouteHandler;
};

export const createNode = (): RouteNode => ({
    staticChildren: new Map()
});

type ParseSegment = 
    {
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

const parseSegment = (segment: string): ParseSegment => {
    // [[...slug]]
    if (segment.startsWith('[[...') && segment.endsWith(']]')) {
        return { type: 'catchAll', name: segment.slice(5, -2), optional: true };
    }

    // [...slug]
    if (segment.startsWith('[...') && segment.endsWith(']')) {
        return { type: 'catchAll', name: segment.slice(4, -1), optional: false };
    }

    // [id]
    if (segment.startsWith('[') && segment.endsWith(']')) {
        return { type: 'param', name: segment.slice(1, -1) };
    }

    return { type: 'static', value: segment };
};

export const insertRoute = (
    root: RouteNode,
    path: string,
    handler: RouteHandler
) => {
    const segments = path.split('/').filter(Boolean);
    let node = root;

    for (const segment of segments) {
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
                    node: createNode()
                };
            }
            node = node.paramChild.node;
            continue;
        }

        if (parsed.type === 'catchAll') {
            if (!node.catchAllChild) {
                node.catchAllChild = {
                    name: parsed.name,
                    optional: parsed.optional,
                    node: createNode()
                };
            }
            node = node.catchAllChild.node;
            break; // catch-all always consumes the rest
        }
    }

    node.handler = handler;
};

type MatchResult = {
    handler: RouteHandler
    params: Params
} | null

export const matchRoute = (
    root: RouteNode,
    path: string
): MatchResult => {
    const segments = path.split('/').filter(Boolean);
    const params: Params = {};

    const walk = (
        node: RouteNode,
        index: number
    ): RouteHandler | null => {
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
            params[node.paramChild.name] = segment;
            const res = walk(node.paramChild.node, index + 1);
            if (res) return res;
            delete params[node.paramChild.name];
        }

        // 3. Catch-all
        if (node.catchAllChild) {
            params[node.catchAllChild.name] = segments.slice(index);
            return node.catchAllChild.node.handler?? null;
        }

        return null;
    }

    const handler = walk(root, 0);
    if (!handler) return null;

    return { handler, params };
}
