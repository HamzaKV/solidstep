import { defineMiddleware } from 'vinxi/http';
import { csp } from '../utils/csp';
import { cors } from '../utils/cors';
import { csrf } from '../utils/csrf';

const trustedOrigins = ['https://example.com', 'https://another-example.com'];

const corsMiddleware = cors(trustedOrigins);
const csrfMiddleware = csrf(trustedOrigins);

const middleware = defineMiddleware({
    onRequest: async (event) => {
        event.node.res.setHeader('Content-Security-Policy', csp);
        event.node.res.setHeader('Vary', 'Origin, Access-Control-Request-Method');
        
        const origin = event.node.req.headers.origin || '';
        const requestUrl = new URL(event.node.req.url, `http://${event.node.req.headers.host || 'localhost'}`);

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
