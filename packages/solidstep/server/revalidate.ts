import { invalidateCache, invalidateTag } from '../utils/cache.js';
import { timingSafeEqualString } from '../utils/crypto.js';
import { isOverBodyLimit, parseContentLength } from '../utils/body-limit.js';

/** This endpoint is dispatched before the app's own middleware pipeline (see
 * `server.ts`), so a configured `bodyLimit()` never protects it -- guard it
 * inline instead. The body is just `{ path }`/`{ tag }`, so this can be tiny. */
const MAX_REVALIDATE_BODY_BYTES = 10_000;

/**
 * Handle a request to `REVALIDATE_ENDPOINT`. The caller is expected to have
 * already gated on `process.env.SOLIDSTEP_REVALIDATE_TOKEN` being set (so the
 * endpoint is unreachable — a 404 via the normal not-found path — when the
 * feature isn't configured), matching the existing `PRERENDER_ENDPOINT`
 * convention.
 */
export const handleRevalidate = async (
    req: Request,
): Promise<{ status: number; body: string }> => {
    if (req.method !== 'POST') {
        return { status: 405, body: 'Method Not Allowed' };
    }

    const token = process.env.SOLIDSTEP_REVALIDATE_TOKEN ?? '';
    const authHeader = req.headers.get('authorization') ?? '';
    // RFC 7235: the auth scheme name is case-insensitive.
    const provided = /^bearer /i.test(authHeader)
        ? authHeader.slice('Bearer '.length)
        : '';
    if (!provided || !timingSafeEqualString(provided, token)) {
        return { status: 401, body: 'Unauthorized' };
    }

    const contentLength = parseContentLength(req.headers.get('content-length'));
    if (isOverBodyLimit(contentLength, MAX_REVALIDATE_BODY_BYTES)) {
        return { status: 413, body: 'Payload Too Large' };
    }

    let payload: { path?: unknown; tag?: unknown };
    try {
        payload = await req.json();
    } catch {
        return { status: 400, body: 'Bad Request' };
    }

    const hasTag = typeof payload.tag === 'string';
    const hasPath = typeof payload.path === 'string';
    if (!hasTag && !hasPath) {
        return {
            status: 400,
            body: 'Bad Request: expected { path } or { tag }',
        };
    }

    const result: { revalidated: true; path?: string; tag?: string } = {
        revalidated: true,
    };
    if (hasTag) {
        await invalidateTag(payload.tag as string);
        result.tag = payload.tag as string;
    }
    if (hasPath) {
        // Two namespaces: the plain page-render cache (bare `path+search`)
        // and the ISR artifact cache (`isr:` prefixed) — see `page-cache.ts`
        // and `server/isr.ts`. The loader-data cache is keyed by manifest
        // path, not URL path, so it's unreachable here; use `{ tag }` for it.
        await invalidateCache(payload.path as string);
        await invalidateCache(`isr:${payload.path}`);
        result.path = payload.path as string;
    }
    return { status: 200, body: JSON.stringify(result) };
};
