/// <reference types='vinxi/types/server' />
import { fromJSON } from 'seroval';
import { SEROVAL_PLUGINS, serializeToStream } from './serialize.js';
import { sharedConfig } from 'solid-js';
import { provideRequestEvent } from 'solid-js/web/storage';
import {
    eventHandler,
    setHeader,
    setResponseStatus,
    type HTTPEvent,
    appendResponseHeader,
    toWebRequest,
    getWebRequest,
    getRequestIP,
    getResponseStatus,
    getResponseStatusText,
    getResponseHeader,
    getResponseHeaders,
    removeResponseHeader,
    setResponseHeader,
} from 'vinxi/http';
import invariant from 'vinxi/lib/invariant';
import { getManifest } from 'vinxi/manifest';
import { RedirectError } from './redirect.js';
import { invalidateCache } from './cache.js';
import {
    createRequestContext,
    createResponseContext,
    getInstrumentation,
    safeExecuteHook,
} from '../utils/instrumentation.js';
import { isTrustedServerActionOrigin } from './server-action-origin.js';

// Dispatch-level failures (unresolvable function, malformed wire payload) are
// distinct from the target action itself throwing: they must map to a plain
// 404/400 regardless of whether the caller is the JS client (`instance` set)
// or a no-JS form post, unlike the generic X-Error/500 handling below.
class ServerFunctionNotFoundError extends Error {}
class ServerFunctionBadRequestError extends Error {}

/* v8 ignore start -- thin Headers-like passthrough over already-tested
   vinxi/http calls, reached only via `getRequestEvent().response` (a
   solid-js primitive no test action here invokes); exercising it would mean
   mocking solid-js/web's request-context machinery just to hit get/set
   forwarding with no branching logic of its own. */
class HeaderProxy {
    constructor(private event: HTTPEvent) {}
    get(key: string) {
        const h = getResponseHeader(this.event, key);
        return Array.isArray(h) ? h.join(', ') : (h as string) || null;
    }
    has(key: string) {
        return this.get(key) !== undefined;
    }
    set(key: string, value: string) {
        return setResponseHeader(this.event, key, value);
    }
    delete(key: string) {
        return removeResponseHeader(this.event, key);
    }
    append(key: string, value: string) {
        appendResponseHeader(this.event, key, value);
    }
    getSetCookie() {
        const cookies = getResponseHeader(this.event, 'Set-Cookie');
        return Array.isArray(cookies) ? cookies : [cookies as string];
    }
    forEach(fn: (value: string, key: string, object: Headers) => void) {
        for (const [key, value] of Object.entries(
            getResponseHeaders(this.event),
        )) {
            fn(
                Array.isArray(value) ? value.join(', ') : (value as string),
                key,
                this as any,
            );
        }
    }
    entries() {
        return Object.entries(getResponseHeaders(this.event))
            .map(
                ([key, value]) =>
                    [key, Array.isArray(value) ? value.join(', ') : value] as [
                        string,
                        string,
                    ],
            )
            [Symbol.iterator]();
    }
    keys() {
        return Object.keys(getResponseHeaders(this.event))[Symbol.iterator]();
    }
    values() {
        return Object.values(getResponseHeaders(this.event))
            .map((value) =>
                Array.isArray(value) ? value.join(', ') : (value as string),
            )
            [Symbol.iterator]();
    }
    [Symbol.iterator]() {
        return this.entries()[Symbol.iterator]();
    }
}

function createResponseStub(event: HTTPEvent) {
    return {
        get status() {
            return getResponseStatus(event);
        },
        set status(v) {
            setResponseStatus(event, v);
        },
        get statusText() {
            return getResponseStatusText(event);
        },
        set statusText(v) {
            setResponseStatus(event, getResponseStatus(event), v);
        },
        headers: new HeaderProxy(event),
    };
}
/* v8 ignore stop */

export async function handleServerFunction(event: HTTPEvent) {
    const request = toWebRequest(event);
    const url = new URL(request.url);
    const inst = getInstrumentation();
    const reqCtx = createRequestContext(request, {
        routePath: url.pathname,
        routeType: 'server-action',
    });
    await safeExecuteHook('onRequest', inst?.onRequest, request, reqCtx);
    // Fired once per response, right before its body is returned/streamed —
    // across whichever branch below produces it (dispatch 404/400, the no-JS
    // redirect, a raw Response passthrough, or the success/error envelope).
    const fireResponseStart = (status: number) =>
        safeExecuteHook(
            'onResponseStart',
            inst?.onResponseStart,
            request,
            createResponseContext(reqCtx, status),
        );

    const security = (globalThis as any).__SOLIDSTEP_CONFIG__?.security
        ?.serverActions as
        | { originCheck?: boolean; trustedOrigins?: string[] }
        | undefined;
    if (
        security?.originCheck !== false &&
        !isTrustedServerActionOrigin(
            request,
            url,
            security?.trustedOrigins || [],
        )
    ) {
        await fireResponseStart(403);
        return process.env.NODE_ENV === 'development'
            ? new Response('Cross-origin server function request blocked', {
                  status: 403,
              })
            : new Response(null, { status: 403 });
    }

    const serverReference = request.headers.get('X-Server-Id');
    const instance = request.headers.get('X-Server-Instance');
    let functionId: string | undefined | null;
    let name: string | undefined | null;
    if (serverReference) {
        invariant(
            typeof serverReference === 'string',
            'Invalid server function',
        );
        [functionId, name] = serverReference.split('#');
    } else {
        functionId = url.searchParams.get('id');
        name = url.searchParams.get('name');
    }

    if (!functionId || !name) {
        await fireResponseStart(404);
        return process.env.NODE_ENV === 'development'
            ? new Response('Server function not found', { status: 404 })
            : new Response(null, { status: 404 });
    }

    try {
        // The real manifest's `chunks` is a lazily-resolving object, not a
        // plain `{}` (`Object.keys`/`Object.hasOwn` don't see its entries —
        // only indexing does), so guarding the *lookup* isn't viable here.
        // Instead validate the *shape* of what comes back: a real chunk
        // always has a callable `.import`, while functionId values like
        // "__proto__"/"constructor"/"toString" resolve (via normal property
        // lookup) to Object.prototype members, none of which do — bypassing
        // the 404 guard below and falling into the generic catch, which
        // (unlike this file's other dispatch-level 404/400 paths) has no
        // dev-only gate on the leaked error message.
        const chunkEntry = getManifest(import.meta.env.ROUTER_NAME!).chunks[
            functionId
        ];
        if (!chunkEntry || typeof chunkEntry.import !== 'function') {
            throw new ServerFunctionNotFoundError(
                `Unknown server function chunk: ${functionId}`,
            );
        }
        const serverFunction = (await chunkEntry.import())[name];

        let parsed: any[] = [];

        // grab bound arguments from url when no JS
        if (!instance || event.method === 'GET') {
            const args = url.searchParams.get('args');
            if (args) {
                let decoded: any;
                try {
                    const json = JSON.parse(args);
                    decoded = json.t
                        ? fromJSON(json, { plugins: SEROVAL_PLUGINS })
                        : json;
                } catch {
                    throw new ServerFunctionBadRequestError(
                        'Malformed args query parameter',
                    );
                }
                for (const arg of decoded) {
                    parsed.push(arg);
                }
            }
        }
        if (event.method === 'POST') {
            const contentType = request.headers.get('content-type');

            // Nodes native IncomingMessage doesn't have a body,
            // But we need to access it for some reason (#1282)
            type EdgeIncomingMessage = typeof event.node.req & {
                body?: BodyInit;
            };
            const h3Request = event.node.req as
                | EdgeIncomingMessage
                | ReadableStream;

            // This should never be the case in 'proper' Nitro presets since node.req has to be IncomingMessage,
            // But the new azure-functions preset for some reason uses a ReadableStream in node.req (#1521)
            const isReadableStream = h3Request instanceof ReadableStream;
            const hasReadableStream =
                (h3Request as EdgeIncomingMessage).body instanceof
                ReadableStream;
            /* v8 ignore next 4 -- azure-functions-only edge case (#1521); a real
               Nitro preset's event.node.req is never a ReadableStream, so these
               branches can't be exercised without faking that runtime's request
               shape, which would test the mock rather than real behavior. */
            const isH3EventBodyStreamLocked =
                (isReadableStream && h3Request.locked) ||
                (hasReadableStream &&
                    ((h3Request as EdgeIncomingMessage).body as ReadableStream)
                        .locked);
            const requestBody = isReadableStream ? h3Request : h3Request.body;

            if (
                contentType?.startsWith('multipart/form-data') ||
                contentType?.startsWith('application/x-www-form-urlencoded')
            ) {
                // workaround for https://github.com/unjs/nitro/issues/1721
                // (issue only in edge runtimes and netlify preset)
                try {
                    /* v8 ignore next -- isH3EventBodyStreamLocked is always
                       false outside the azure-functions preset (see above),
                       so the `request` branch here can't be exercised. */
                    parsed.push(
                        await (isH3EventBodyStreamLocked
                            ? request
                            : new Request(request, {
                                  ...request,
                                  body: requestBody,
                              })
                        ).formData(),
                        // what should work when #1721 is fixed
                        // parsed.push(await request.formData);
                    );
                } catch {
                    throw new ServerFunctionBadRequestError(
                        'Malformed form-data body',
                    );
                }
            } else if (contentType?.startsWith('application/json')) {
                // workaround for https://github.com/unjs/nitro/issues/1721
                // (issue only in edge runtimes and netlify preset)
                /* v8 ignore next -- isH3EventBodyStreamLocked is always false
                   outside the azure-functions preset (see above), so the
                   `request` branch here can't be exercised. */
                const tmpReq = isH3EventBodyStreamLocked
                    ? request
                    : new Request(request, { ...request, body: requestBody });
                try {
                    // what should work when #1721 is fixed
                    // just use request.json() here
                    parsed = fromJSON(await tmpReq.json(), {
                        plugins: SEROVAL_PLUGINS,
                    });
                } catch {
                    throw new ServerFunctionBadRequestError(
                        'Malformed JSON body',
                    );
                }
            }
        }
        // The request event owns its own `locals`, initialized here. Attaching the
        // metadata to the native h3 event instead would crash when no user middleware
        // has set `event.locals` (it is optional), and would also place the metadata
        // off the event that user code reads via `getRequestEvent().locals`.
        const requestEvent = {
            request: getWebRequest(event),
            response: createResponseStub(event),
            clientAddress: getRequestIP(event),
            locals: {} as Record<string, any>,
            nativeEvent: event,
        };
        let result = await provideRequestEvent(requestEvent, async () => {
            sharedConfig.context = { event } as any;
            requestEvent.locals.serverFunctionMeta = {
                id: `${functionId}#${name}`,
            };
            return serverFunction(...parsed);
        });

        // No-JS fallback: native form submission without client-side JS
        // When there's no X-Server-Instance header, this is a plain form POST.
        // Execute the action and redirect back to the referring page.
        if (!instance) {
            // The Referer is always an absolute URL (unlike `?next=`-style
            // user-supplied redirect targets, which are usually relative) --
            // validate it's same-origin as this request rather than reusing
            // `isSafeRedirectTarget`'s relative-path-oriented allowlist, and
            // fall back to `/` for a cross-origin or malformed value so a
            // non-browser caller can't turn a real action into an open
            // redirect to an arbitrary URL.
            const referer = request.headers.get('Referer');
            let location = '/';
            if (referer) {
                try {
                    if (
                        new URL(referer).origin === new URL(request.url).origin
                    ) {
                        location = referer;
                    }
                } catch {
                    // malformed Referer -- keep the '/' fallback
                }
            }
            setResponseStatus(event, 303);
            setHeader(event, 'Location', location);
            await fireResponseStart(303);
            return '';
        }

        // handle responses
        if (result instanceof Response) {
            if (result.headers?.has('X-Content-Raw')) {
                /* v8 ignore next -- a native Response's status is spec'd to
                   always be in 200-599 (the constructor throws otherwise), so
                   it's never falsy; this fallback can't fire with a real
                   Response. */
                await fireResponseStart(result.status || 200);
                return result;
            }
            if (instance) {
                // forward headers
                // if (result.headers) mergeResponseHeaders(event, result.headers);
                // forward non-redirect statuses
                if (
                    result.status &&
                    (result.status < 300 || result.status >= 400)
                )
                    setResponseStatus(event, result.status);
                if ((result as any).customBody) {
                    result = await (result as any).customBody();
                } else {
                    /* v8 ignore next -- a native Response's `.body` is spec'd
                       to be ReadableStream | null, never undefined; this is a
                       defensive branch that can't fire with a real Response. */
                    if (result.body === undefined) result = null;
                }
            }
        }

        // If the action marked a path for revalidation, drop its cached render.
        // The `X-Revalidate` header remains on the response; the client router
        // re-fetches the route's loader data and re-renders reactively (no DOM
        // diffing) — see `refreshRoute` in `utils/router-context`.
        const revalidatePath = getResponseHeader(event, 'X-Revalidate') as
            | string
            | undefined;
        if (revalidatePath) {
            await invalidateCache(revalidatePath);
        }

        setHeader(event, 'content-type', 'text/javascript');
        /* v8 ignore next -- H3's getResponseStatus() defaults to 200 and is
           only ever set to another value by setResponseStatus() above, never
           to a falsy one; this fallback can't fire in practice. */
        await fireResponseStart(getResponseStatus(event) || 200);
        return serializeToStream(instance as string, result);
    } catch (x) {
        await safeExecuteHook(
            'onRequestError',
            inst?.onRequestError,
            x instanceof Error ? x : new Error(String(x)),
            request,
            reqCtx,
        );

        if (x instanceof ServerFunctionNotFoundError) {
            await fireResponseStart(404);
            return process.env.NODE_ENV === 'development'
                ? new Response(x.message, { status: 404 })
                : new Response(null, { status: 404 });
        }
        if (x instanceof ServerFunctionBadRequestError) {
            await fireResponseStart(400);
            return process.env.NODE_ENV === 'development'
                ? new Response(x.message, { status: 400 })
                : new Response(null, { status: 400 });
        }

        if (x instanceof Response) {
            // forward headers
            // if ((x as any).headers) mergeResponseHeaders(event, (x as any).headers);
            // forward non-redirect statuses
            if (
                (x as any).status &&
                (!instance ||
                    (x as any).status < 300 ||
                    (x as any).status >= 400)
            )
                setResponseStatus(event, (x as any).status);
            if ((x as any).customBody) {
                // biome-ignore lint/suspicious/noCatchAssign: the caught Response is deliberately replaced with its serializable body
                x = (x as any).customBody();
            } else {
                /* v8 ignore next -- a native Response's `.body` is spec'd to
                   be ReadableStream | null, never undefined; this is a
                   defensive branch that can't fire with a real Response. */
                // biome-ignore lint/suspicious/noCatchAssign: a bodyless Response is normalized to null before serialization
                if ((x as any).body === undefined) x = null;
            }
            setHeader(event, 'X-Error', 'true');
        } else if (instance) {
            const error =
                x instanceof Error
                    ? x.message
                    : typeof x === 'string'
                      ? x
                      : 'true';
            setHeader(event, 'X-Error', error.replace(/[\r\n]+/g, ''));
            if (!(x instanceof RedirectError)) {
                setResponseStatus(event, 500);
            }
        }
        /* v8 ignore next -- see the matching comment in the try block above:
           getResponseStatus() is never falsy here. */
        await fireResponseStart(getResponseStatus(event) || 200);
        if (instance) {
            setHeader(event, 'content-type', 'text/javascript');
            return serializeToStream(instance, x);
        }
        return x;
    } finally {
        /* v8 ignore next -- see the matching comment above: getResponseStatus()
           is never falsy here. */
        const statusCode = getResponseStatus(event) || 200;
        const respCtx = createResponseContext(reqCtx, statusCode);
        await safeExecuteHook(
            'onResponseEnd',
            inst?.onResponseEnd,
            request,
            respCtx,
        );
    }
}

export default eventHandler(handleServerFunction);
