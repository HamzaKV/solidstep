import { defineMiddleware, type Middleware } from 'solidstep/utils/middleware';
import { createBasePolicy, serializePolicy, withNonce } from 'solidstep/utils/csp';
import { cors } from 'solidstep/utils/cors';
import { csrf } from 'solidstep/utils/csrf';
import { randomBytes } from 'node:crypto';

const trustedOrigins = ['https://example.com', 'https://another-example.com'];

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
        (event as any).locals = { cspNonce: nonce };

        let policy = createBasePolicy();
        policy = withNonce(policy, nonce);
        event.node.res.setHeader('Content-Security-Policy', serializePolicy(policy));
        event.node.res.setHeader('Vary', 'Origin, Access-Control-Request-Method');

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

export default defineMiddleware([logger, security]);
