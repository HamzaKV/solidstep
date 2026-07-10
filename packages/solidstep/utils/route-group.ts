/**
 * Locate a parallel-route group (`@name` directory) in a clean route path.
 *
 * Only a path segment that STARTS with `@` is a group (matching typegen's
 * per-segment rule) — a literal `@` inside a segment (`/foo@bar`) is an
 * ordinary page path, not a group. The group spans from its `@segment` to the
 * end of the path (a group dir's files sit directly inside it).
 */
export const parseGroupPath = (
    path: string,
): { group: string; parent: string } | null => {
    const segments = path.split('/');
    const at = segments.findIndex((seg) => seg.startsWith('@'));
    if (at === -1) return null;
    const group = segments.slice(at).join('/');
    return { group, parent: segments.slice(0, at).join('/') };
};
