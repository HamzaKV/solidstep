import { defineMiddleware, type Middleware } from 'solidstep/utils/middleware';
import {
    createBasePolicy,
    serializePolicy,
    withNonce,
} from 'solidstep/utils/csp';
import { cors } from 'solidstep/utils/cors';
import { csrf } from 'solidstep/utils/csrf';
import { bodyLimit } from 'solidstep/utils/body-limit';
import { rateLimit } from 'solidstep/utils/rate-limit';
import { randomBytes } from 'node:crypto';

// EDIT ME: add every origin that legitimately calls this app cross-origin
// (another site of yours, a partner integration). Set via the
// TRUSTED_ORIGINS env var (comma-separated) in production — do not commit
// real production origins here.
const trustedOrigins = process.env.TRUSTED_ORIGINS?.split(',') ?? [
    'https://example.com',
    'https://another-example.com',
];

const corsMiddleware = cors(trustedOrigins);
const csrfMiddleware = csrf(trustedOrigins);

// Logs every request. A lightweight composable unit.
const logger: Middleware = {
    onRequest: (event) => {
        console.log(`[req] ${event.node.req.method} ${event.path}`);
    },
};

// Sets a per-request CSP nonce, enforces CSRF on unsafe methods, and applies
// CORS for trusted origins. Short-circuits the chain by returning a Response.
const security: Middleware = {
    onRequest: (event) => {
        const nonce = randomBytes(16).toString('base64');
        (event as any).locals = { ...(event as any).locals, cspNonce: nonce };

        let policy = createBasePolicy();
        policy = withNonce(policy, nonce);
        event.node.res.setHeader(
            'Content-Security-Policy',
            serializePolicy(policy),
        );
        event.node.res.setHeader(
            'Vary',
            'Origin, Access-Control-Request-Method',
        );

        const origin = (event.node.req.headers.origin as string) || '';
        const protocol = origin.startsWith('https') ? 'https' : 'http';
        const requestUrl = new URL(
            event.node.req.url || '/',
            `${protocol}://${event.node.req.headers.host || 'localhost'}`,
        );

        const csrfResult = csrfMiddleware(
            event.node.req.method || 'GET',
            requestUrl,
            origin,
            event.node.req.headers.referer,
        );
        if (!csrfResult.success) {
            return new Response(csrfResult.message, { status: 403 });
        }

        if (origin) {
            const corsHeaders = corsMiddleware(
                origin,
                event.node.req.method === 'OPTIONS',
            );
            for (const [key, value] of Object.entries(corsHeaders)) {
                event.node.res.setHeader(key, value);
            }
            if (
                event.node.req.method === 'OPTIONS' &&
                event.node.req.headers['access-control-request-method']
            ) {
                return new Response(null, { status: 204 });
            }
        }
    },
};

// Conservative defaults — tighten or loosen for your app's actual traffic
// shape. Both run first so oversized/abusive requests short-circuit before
// the CSP/CSRF/CORS work below.
export default defineMiddleware([
    bodyLimit({ maxBytes: 1_000_000 }), // 1 MB
    rateLimit({ windowMs: 60_000, max: 100 }), // 100 req/min per client IP
    logger,
    security,
]);
