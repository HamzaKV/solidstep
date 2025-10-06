import { defineMiddleware } from 'vinxi/http';
import { cspNonce as csp } from '../utils/csp';
import { cors } from '../utils/cors';
import { csrf } from '../utils/csrf';
import { randomBytes } from 'node:crypto';

const trustedOrigins = ['https://example.com', 'https://another-example.com'];

const corsMiddleware = cors(trustedOrigins);
const csrfMiddleware = csrf(trustedOrigins);

const middleware = defineMiddleware({
    onRequest: async (event) => {
        const nonce = randomBytes(16).toString('base64');

        (event as any).locals = {
            cspNonce: nonce,
        };

        event.node.res.setHeader('Content-Security-Policy', csp(nonce));
        event.node.res.setHeader('Vary', 'Origin, Access-Control-Request-Method');
        
        const origin = event.node.req.headers.origin || '';
        const protocol = origin.startsWith('https') ? 'https' : 'http';
        const requestUrl = new URL(event.node.req.url, `${protocol}://${event.node.req.headers.host || 'localhost'}`);

        const csrfResult = csrfMiddleware(
            event.node.req.method,
            requestUrl,
            origin,
            event.node.req.headers.referer
        );

        if (!csrfResult.success) {
            event.node.res.statusCode = 403; // Forbidden
            event.node.res.end(csrfResult.message);
            return;
        }

        if (origin) {
            const corsHeaders = corsMiddleware(origin, event.node.req.method === 'OPTIONS');
            for (const [key, value] of Object.entries(corsHeaders)) {
                event.node.res.setHeader(key, value);
            }
            if (
                event.node.req.method === 'OPTIONS'
                && event.node.req.headers['access-control-request-method']
            ) {
                event.node.res.statusCode = 204; // No Content for preflight requests
                event.node.res.end();
                return;
            }
        }
    },
});

export default middleware;
