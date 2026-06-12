/**
 * A function exported as `generateStaticParams` from a page module. Returns the
 * set of param maps to prerender for a dynamic `render: 'static' | 'isr'` route.
 * Each entry maps a route param name to its value (a string, or a string array
 * for catch-all segments).
 *
 * @example
 * ```ts
 * export const generateStaticParams: GenerateStaticParams = async () => [
 *   { slug: 'hello-world' },
 *   { slug: 'second-post' },
 * ];
 * ```
 */
export type GenerateStaticParams = () =>
    | Array<Record<string, string | string[]>>
    | Promise<Array<Record<string, string | string[]>>>;

/** A reconstructed route-pattern segment (from the route trie). */
export type PatternSegment =
    | { kind: 'static'; value: string }
    | { kind: 'param'; name: string }
    | { kind: 'catchAll'; name: string; optional: boolean };

/** A concrete page to prerender at build time. */
export type PrerenderTarget = {
    /** The concrete URL pathname (e.g. `/blog/hello-world`). */
    pathname: string;
    /**
     * The page's rendering strategy: fully static (SSG), incrementally
     * regenerated (ISR), or a partially-prerendered shell (PPR). `static` and
     * `ppr` are both written as `.html` artifacts (a PPR artifact is the shell).
     */
    render: 'static' | 'isr' | 'ppr';
    /** ISR revalidation interval in seconds (omitted for `static`/`ppr`). */
    revalidate?: number;
    /** Cache tags carried from the page's `options.cache.tags`. */
    tags?: string[];
};

/** Page `options` fields consulted during prerendering. */
export type PrerenderOptions = {
    render?: 'static' | 'isr' | 'dynamic' | 'ppr';
    revalidate?: number;
    cache?: { tags?: string[] };
};

/** Default ISR revalidation interval (seconds) when `revalidate` is omitted. */
export const DEFAULT_REVALIDATE = 60;

/** Whether a route pattern contains any dynamic (`param`/`catchAll`) segment. */
export const hasDynamicSegments = (segments: PatternSegment[]): boolean =>
    segments.some((s) => s.kind !== 'static');

/**
 * Build a concrete pathname from a route pattern and a param map.
 *
 * - `static` segments contribute their literal value.
 * - `param` segments require a string value in `params`.
 * - `catchAll` segments expand an array value into multiple path segments; an
 *   optional catch-all with no value collapses to the base path.
 *
 * @throws If a required `param`/`catchAll` value is missing from `params`.
 */
export const buildConcretePath = (
    segments: PatternSegment[],
    params: Record<string, string | string[]> = {},
): string => {
    const parts: string[] = [];
    for (const seg of segments) {
        if (seg.kind === 'static') {
            parts.push(seg.value);
            continue;
        }
        const value = params[seg.name];
        if (seg.kind === 'param') {
            if (typeof value !== 'string') {
                throw new Error(
                    `Missing param "${seg.name}" for static generation`,
                );
            }
            parts.push(value);
            continue;
        }
        // catch-all
        if (value === undefined) {
            if (seg.optional) continue;
            throw new Error(
                `Missing catch-all param "${seg.name}" for static generation`,
            );
        }
        const arr = Array.isArray(value) ? value : [value];
        parts.push(...arr.map(String));
    }
    return `/${parts.join('/')}`;
};

/**
 * Expand a single page route into the concrete {@link PrerenderTarget}s to
 * generate at build time, given the page's `options` and (for dynamic routes)
 * the result of its `generateStaticParams`.
 *
 * Returns an empty array when the route is not `static`/`isr`, or when it is
 * dynamic but supplies no static params (it can't be prerendered without them —
 * the caller should warn).
 */
export const expandRoute = (
    segments: PatternSegment[],
    options: PrerenderOptions | undefined,
    staticParams: Array<Record<string, string | string[]>> | undefined,
): PrerenderTarget[] => {
    const render = options?.render;
    if (render !== 'static' && render !== 'isr' && render !== 'ppr') return [];

    const tags = options?.cache?.tags;
    const revalidate =
        render === 'isr'
            ? (options?.revalidate ?? DEFAULT_REVALIDATE)
            : undefined;

    if (!hasDynamicSegments(segments)) {
        return [{ pathname: buildConcretePath(segments), render, revalidate, tags }];
    }

    if (!staticParams || staticParams.length === 0) return [];

    return staticParams.map((params) => ({
        pathname: buildConcretePath(segments, params),
        render,
        revalidate,
        tags,
    }));
};
