/// <reference types='vinxi/types/server' />
import { fromJSON } from 'seroval';
import { SEROVAL_PLUGINS, serializeToStream } from './serialize';
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
import { RedirectError } from './redirect';
import { createDiffDOM } from './diff-dom';
import { getCache, invalidateCache } from './cache';
import fetch from './fetch.server';
import {
    createRequestContext,
    createResponseContext,
    getInstrumentation,
    safeExecuteHook,
} from '../utils/instrumentation';

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
        return Object.entries(getResponseHeaders(this.event)).forEach(
            ([key, value]) =>
                fn(
                    Array.isArray(value) ? value.join(', ') : (value as string),
                    key,
                    this as any,
                ),
        );
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

export async function handleServerFunction(event: HTTPEvent) {
    const request = toWebRequest(event);
    const url = new URL(request.url);
    const inst = getInstrumentation();
    const reqCtx = createRequestContext(request, {
        routePath: url.pathname,
        routeType: 'server-action',
    });
    await safeExecuteHook('onRequest', inst?.onRequest, request, reqCtx);

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

        if (!functionId || !name) {
            return process.env.NODE_ENV === 'development'
                ? new Response('Server function not found', { status: 404 })
                : new Response(null, { status: 404 });
        }
    }

    const serverFunction = (
        await getManifest(import.meta.env.ROUTER_NAME).chunks[
            functionId
        ].import()
    )[name];

    let parsed: any[] = [];

    // grab bound arguments from url when no JS
    if (!instance || event.method === 'GET') {
        const args = url.searchParams.get('args');
        if (args) {
            const json = JSON.parse(args);
            (json.t
                ? (fromJSON(json, {
                      plugins: SEROVAL_PLUGINS,
                  }) as any)
                : json
            ).forEach((arg: any) => parsed.push(arg));
        }
    }
    if (event.method === 'POST') {
        const contentType = request.headers.get('content-type');

        // Nodes native IncomingMessage doesn't have a body,
        // But we need to access it for some reason (#1282)
        type EdgeIncomingMessage = typeof event.node.req & { body?: BodyInit };
        const h3Request = event.node.req as
            | EdgeIncomingMessage
            | ReadableStream;

        // This should never be the case in 'proper' Nitro presets since node.req has to be IncomingMessage,
        // But the new azure-functions preset for some reason uses a ReadableStream in node.req (#1521)
        const isReadableStream = h3Request instanceof ReadableStream;
        const hasReadableStream =
            (h3Request as EdgeIncomingMessage).body instanceof ReadableStream;
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
            parsed.push(
                await (isH3EventBodyStreamLocked
                    ? request
                    : new Request(request, { ...request, body: requestBody })
                ).formData(),
            );
            // what should work when #1721 is fixed
            // parsed.push(await request.formData);
        } else if (contentType?.startsWith('application/json')) {
            // workaround for https://github.com/unjs/nitro/issues/1721
            // (issue only in edge runtimes and netlify preset)
            const tmpReq = isH3EventBodyStreamLocked
                ? request
                : new Request(request, { ...request, body: requestBody });
            // what should work when #1721 is fixed
            // just use request.json() here
            parsed = fromJSON(await tmpReq.json(), {
                plugins: SEROVAL_PLUGINS,
            });
        }
    }
    try {
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
            const referer = request.headers.get('Referer') || '/';
            setResponseStatus(event, 303);
            setHeader(event, 'Location', referer);
            return '';
        }

        // handle responses
        if (result instanceof Response) {
            if (result.headers?.has('X-Content-Raw')) return result;
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
                } else if (result.body === undefined) result = null;
            }
        }

        const revalidatePath = getResponseHeader(event, 'X-Revalidate') as
            | string
            | undefined;

        // Step 1: check if revalidation is needed
        if (revalidatePath) {
            // Step 2: get generated html page from cache
            const cacheValue = await getCache<any | null>(revalidatePath);
            const oldHtml = cacheValue?.rendered;

            // Step 3: invalidate cache for path
            await invalidateCache(revalidatePath);

            let diff: any;

            if (oldHtml) {
                // Step 4: diff the cache with new html from server
                const reqUrl = new URL(request.url);
                const serverUrl = reqUrl.origin;
                const response = await fetch(
                    serverUrl + revalidatePath,
                    {
                        method: 'GET',
                    },
                    false,
                );
                await response.text(); // ensure the fetch is completed and cache is populated
                const newCacheValue = await getCache<any | null>(revalidatePath);
                const newHtml = newCacheValue?.rendered;
                const dd = createDiffDOM({
                    skipSelector: 'SCRIPT, STYLE, NOSCRIPT',
                    skipMode: 'full',
                });
                const ddDiff = dd.diff(oldHtml, newHtml);
                diff = structuredClone(ddDiff);
            }

            // Step 5: add the changed html as json to the result
            result = {
                result,
                diff,
            };
        }

        setHeader(event, 'content-type', 'text/javascript');
        return serializeToStream(instance as string, result);
    } catch (x) {
        await safeExecuteHook(
            'onRequestError',
            inst?.onRequestError as any,
            x instanceof Error ? x : new Error(String(x)),
            request,
            reqCtx,
        );

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
                // biome-ignore lint/suspicious/noCatchAssign: <explanation>
                x = (x as any).customBody();
                // biome-ignore lint/suspicious/noCatchAssign: <explanation>
            } else if ((x as any).body === undefined) x = null;
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
        if (instance) {
            setHeader(event, 'content-type', 'text/javascript');
            return serializeToStream(instance, x);
        }
        return x;
    } finally {
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
