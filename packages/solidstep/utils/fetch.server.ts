import { fetch } from 'undici';

export type FetchResponse<T, S extends boolean> = S extends true
    ? T
    : Response;

type Options = {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    body?: any;
    headers?: any;
    MAX_FETCH_TIME?: number;
};

/**
 * It's a wrapper around the native fetch function that adds a timeout and a json parser
 * @param {string} url - string - The URL to fetch
 * @param {Options} [options] - {
 *  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
 *  body?: any;
 *  headers?: any;
 *  MAX_FETCH_TIME?: number;
 * }
 * @param [json=true] - boolean - If the response is JSON, it will be parsed and returned.
 * @returns The return type is Promise<any>
 */
const Fetch = async <T, S extends boolean = true>(
    url: string,
    options?: Options,
    json: S = true as S,
): Promise<FetchResponse<T, S>> => {
    // AbortController was added in node v14.17.0 globally
    const AbortController = globalThis.AbortController;
    const maxTime = options?.MAX_FETCH_TIME ?? 4000;

    const controller = new AbortController();

    const timeout = setTimeout(() => {
        controller.abort();
    }, maxTime);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal,
        });

        if (response?.status >= 400 && response?.status <= 599) {
            if (json) {
                throw await response.json();
            }
            throw response;
        }

        if (json) {
            const data: any = await response.json();

            if (data) {
                if (data.error) throw data.error; // in case the status is marked as 200 but the response is an error
                return data as FetchResponse<T, S>;
            }

            throw new Error('Not Defined');
        }

        return response as FetchResponse<T, S>;
    } catch (error) {
        if (controller.signal.aborted) {
            throw new Error('Timeout');
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
};

export default Fetch;
