import { invalidateCache, invalidateTag } from '../utils/cache.js';
import { timingSafeEqualString } from '../utils/crypto.js';

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
    const provided = authHeader.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length)
        : '';
    if (!provided || !timingSafeEqualString(provided, token)) {
        return { status: 401, body: 'Unauthorized' };
    }

    let payload: { path?: unknown; tag?: unknown };
    try {
        payload = await req.json();
    } catch {
        return { status: 400, body: 'Bad Request' };
    }

    if (typeof payload.tag === 'string') {
        await invalidateTag(payload.tag);
        return {
            status: 200,
            body: JSON.stringify({ revalidated: true, tag: payload.tag }),
        };
    }
    if (typeof payload.path === 'string') {
        // Two namespaces: the plain page-render cache (bare `path+search`)
        // and the ISR artifact cache (`isr:` prefixed) — see `page-cache.ts`
        // and `server/isr.ts`. The loader-data cache is keyed by manifest
        // path, not URL path, so it's unreachable here; use `{ tag }` for it.
        await invalidateCache(payload.path);
        await invalidateCache(`isr:${payload.path}`);
        return {
            status: 200,
            body: JSON.stringify({ revalidated: true, path: payload.path }),
        };
    }

    return { status: 400, body: 'Bad Request: expected { path } or { tag }' };
};
