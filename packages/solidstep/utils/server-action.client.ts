import fetch from './fetch.client';
import { toJSONAsync } from 'seroval';
import { SEROVAL_PLUGINS, SerovalChunkReader } from './serialize';
import { refreshRoute } from './router-context';

async function deserializeStream(id: string, response: Response) {
    if (!response.body) {
        throw new Error('missing body');
    }
    const reader = new SerovalChunkReader(response.body);

    const result = await reader.next();

    if (!result.done) {
        reader.drain().then(
            () => {
                // @ts-ignore
                delete $R[id];
            },
            () => {
                // no-op
            },
        );
    }

    return result.value;
}

let INSTANCE = 0;

function createRequest(
    base: string,
    id: string,
    instance: string,
    options: RequestInit,
) {
    return fetch(
        base,
        {
            method: 'POST' as any,
            ...options,
            headers: {
                ...options.headers,
                'X-Server-Id': id,
                'X-Server-Instance': instance,
                'server-action': id,
            },
            serverAction: true,
        },
        false,
    );
}

async function fetchServerFunction(
    base: string,
    id: string,
    options: Omit<RequestInit, 'body'>,
    args: any[],
) {
    const instance = `server-fn:${INSTANCE++}`;
    const response = await (args.length === 0
        ? createRequest(base, id, instance, options)
        : args.length === 1 && args[0] instanceof FormData
          ? createRequest(base, id, instance, { ...options, body: args[0] })
          : args.length === 1 && args[0] instanceof URLSearchParams
            ? createRequest(base, id, instance, {
                  ...options,
                  body: args[0],
                  headers: {
                      ...options.headers,
                      'Content-Type': 'application/x-www-form-urlencoded',
                  },
              })
            : createRequest(base, id, instance, {
                  ...options,
                  body: JSON.stringify(
                      await Promise.resolve(
                          toJSONAsync(args, { plugins: SEROVAL_PLUGINS }),
                      ),
                  ),
                  headers: {
                      ...options.headers,
                      'Content-Type': 'application/json',
                  },
              }));

    /*if (
		response.headers.has('Location') ||
		response.headers.has('X-Revalidate') ||
		response.headers.has('X-Single-Flight')
	) {
		if (response.body) {
			/* @ts-ignore-next-line 
			response.customBody = () => {
				return deserializeStream(instance, response);
			};
		}
		return response;
	}*/

    const contentType = response.headers.get('Content-Type');
    let result: any;
    if (contentType?.startsWith('text/plain')) {
        result = await response.text();
    } else if (contentType?.startsWith('application/json')) {
        result = await response.json();
    } else {
        result = await deserializeStream(instance, response);
    }

    if (response.headers.has('X-Error')) {
        if (result.name === 'RedirectError') {
            window.location.href = result.message;
        }
        throw result;
    }

    if (response.headers.has('X-Revalidate')) {
        const revalidatePath = response.headers.get('X-Revalidate');
        // Re-render the current route reactively if the action revalidated it.
        // `refreshRoute` re-fetches the route's loader data + metadata and
        // updates the router state in place (replacing the old DOM-diff path).
        if (revalidatePath === window.location.pathname) {
            await refreshRoute();
        }
        return result;
    }

    return result;
}

// biome-ignore lint/complexity/noBannedTypes: <explanation>
export function createServerReference(fn: Function, id: string, name: string) {
    const baseURL = import.meta.env.SERVER_BASE_URL;
    return new Proxy(fn, {
        get(target, prop, receiver) {
            if (prop === 'url') {
                return `${baseURL}/_server?id=${encodeURIComponent(id)}&name=${encodeURIComponent(name)}`;
            }
            if (prop === 'GET') {
                return receiver.withOptions({ method: 'GET' });
            }
            if (prop === 'withOptions') {
                const url = `${baseURL}/_server/?id=${encodeURIComponent(id)}&name=${encodeURIComponent(
                    name,
                )}`;
                return (options: RequestInit) => {
                    const fn = async (...args: any[]) => {
                        const encodeArgs =
                            options.method &&
                            options.method.toUpperCase() === 'GET';
                        return fetchServerFunction(
                            encodeArgs
                                ? url +
                                      (args.length
                                          ? `&args=${encodeURIComponent(
                                                JSON.stringify(
                                                    await Promise.resolve(
                                                        toJSONAsync(args, {
                                                            plugins:
                                                                SEROVAL_PLUGINS,
                                                        }),
                                                    ),
                                                ),
                                            )}`
                                          : '')
                                : `${baseURL}/_server`,
                            `${id}#${name}`,
                            options,
                            encodeArgs ? [] : args,
                        );
                    };
                    fn.url = url;
                    return fn;
                };
            }
            return (target as any)[prop];
        },
        apply(target, thisArg, args) {
            const maxClientFetchTime = +import.meta.env
                .VITE_SERVER_ACTION_MAX_CLIENT_FETCH_TIME;
            return fetchServerFunction(
                `${baseURL}/_server`,
                `${id}#${name}`,
                {
                    MAX_FETCH_TIME: maxClientFetchTime || undefined,
                } as any,
                args,
            );
        },
    });
}
