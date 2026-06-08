/**
 * Document-head tags to inject for a route, keyed by a stable id.
 *
 * Each entry describes one `link`, `meta`, `script`, `style`, or `title` tag:
 * `attributes` become the element's HTML attributes and `content` (when given)
 * its inner text.
 */
export type Meta = {
    [key: string]: {
        type: 'link' | 'meta' | 'script' | 'style' | 'title';
        attributes: Record<string, string>;
        content?: string;
    };
};

type MetaFunctionParameters = {
    req: Request;
    cspNonce?: string;
};
/**
 * Function that computes the head {@link Meta} for a route from the incoming
 * `Request` (and the CSP `cspNonce`, when one is in use). May be async.
 */
export type MetaFunction = (
    params: MetaFunctionParameters,
) => Promise<Meta> | Meta;

/**
 * Identity helper for defining a route's {@link MetaFunction} with full type
 * inference. Export its result as `meta` from a route module.
 *
 * @param metaFunction - The meta resolver.
 * @returns The same function, typed as a `MetaFunction`.
 */
export const meta = (metaFunction: MetaFunction) => metaFunction;
