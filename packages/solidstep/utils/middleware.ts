// utils/middleware.ts
// Composable middleware for SolidStep.
//
// Vinxi/H3 only allow a single middleware module per router. This helper lets
// you split request/response concerns (auth, CORS, CSRF, logging, ...) into
// independent units and compose them into one Vinxi-compatible middleware.

import { defineMiddleware as defineVinxiMiddleware, type H3Event } from 'vinxi/http';

/**
 * Runs before the matched route handler. Return a `Response` (or call
 * `event.respondWith(...)`) to short-circuit the chain — later middleware and
 * the route handler are skipped.
 */
export type MiddlewareRequestHandler = (
    event: H3Event,
) => void | Response | Promise<void | Response>;

/**
 * Runs after the route handler, before the response is sent. Receives the
 * resolved response body so it can be inspected or mutated. Cannot short-circuit.
 */
export type MiddlewareResponseHandler = (
    event: H3Event,
    response: { body?: unknown },
) => void | Promise<void>;

/** A single middleware unit. Either hook is optional. */
export type Middleware = {
    onRequest?: MiddlewareRequestHandler;
    onBeforeResponse?: MiddlewareResponseHandler;
};

/**
 * Compose an ordered array of middleware into a single Vinxi middleware object.
 *
 * `onRequest` hooks run in array order and stop as soon as one returns a
 * `Response` or marks the event handled. `onBeforeResponse` hooks always all
 * run, in array order.
 *
 * @example
 * ```ts
 * // app/middleware.ts
 * import { defineMiddleware } from 'solidstep/utils/middleware';
 *
 * export default defineMiddleware([
 *   authMiddleware,
 *   corsMiddleware,
 *   csrfMiddleware,
 * ]);
 * ```
 */
export const defineMiddleware = (middlewares: Middleware[]) =>
    defineVinxiMiddleware({
        onRequest: async (event) => {
            for (const middleware of middlewares) {
                if (!middleware.onRequest) continue;
                const result = await middleware.onRequest(event);
                if (result instanceof Response) {
                    await event.respondWith(result);
                    return;
                }
                if (event.handled) return;
            }
        },
        onBeforeResponse: async (event, response) => {
            for (const middleware of middlewares) {
                if (!middleware.onBeforeResponse) continue;
                await middleware.onBeforeResponse(event, response);
            }
        },
    });
