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

const trustedOrigins = ['https://trusted.example.com'];
const corsMiddleware = cors(trustedOrigins);
const csrfMiddleware = csrf(trustedOrigins);

// Scoped to /api/limits-test only (a fixed key, not per-IP, so bursts from
// the e2e suite's shared local IP behave predictably) so these conservative
// limits don't affect any other route's traffic. See
// tests/rate-body-limit.spec.ts.
const testBodyLimit = bodyLimit({ maxBytes: 100 });
const testRateLimit = rateLimit({
    windowMs: 60_000,
    max: 3,
    key: () => 'e2e-limits-test',
});
const limitsTest: Middleware = {
    onRequest: (event) => {
        if (event.path.split('?')[0] !== '/api/limits-test') return;
        return (
            testBodyLimit.onRequest?.(event) ?? testRateLimit.onRequest?.(event)
        );
    },
};

// Logs every request. Demonstrates a lightweight composable unit.
const logger: Middleware = {
    onRequest: (event) => {
        console.log(`[req] ${event.node.req.method} ${event.path}`);
    },
};

// Sets a per-request CSP nonce, enforces CSRF on unsafe methods, and applies
// CORS for trusted origins. Demonstrates short-circuiting by returning a Response.
const security: Middleware = {
    onRequest: (event) => {
        const nonce = randomBytes(16).toString('base64');
        (event as any).locals = { cspNonce: nonce };

        let policy = createBasePolicy();
        policy = withNonce(policy, nonce);
        event.node.res.setHeader(
            'Content-Security-Policy',
            serializePolicy(policy),
        );
        // Exposed purely so the e2e suite can assert the nonce is applied.
        event.node.res.setHeader('X-CSP-Nonce', nonce);
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

export default defineMiddleware([logger, limitsTest, security]);
