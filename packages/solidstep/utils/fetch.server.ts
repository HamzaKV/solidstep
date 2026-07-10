import { fetch } from 'undici';

export type FetchResponse<T, S extends boolean> = S extends true ? T : Response;

type Options = {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    body?: any;
    headers?: any;
    MAX_FETCH_TIME?: number;
};

/**
 * A wrapper around `undici`'s `fetch` that adds an abort timeout and optional
 * JSON parsing (server build).
 *
 * Responses with a 4xx/5xx status are thrown: as the parsed JSON body when
 * `json` is `true`, otherwise as the raw `Response`. When `json` is `true`, a
 * successful body containing an `error` field is also thrown (to handle errors
 * returned under a 200 status). An aborted request (timeout) throws
 * `Error('Timeout')`.
 *
 * @typeParam T - Expected shape of the parsed JSON body.
 * @typeParam S - Whether JSON parsing is enabled; controls the return type via
 *   {@link FetchResponse} (`T` when `true`, otherwise the raw `Response`).
 * @param url - The URL to fetch.
 * @param options - Request options. `MAX_FETCH_TIME` is the abort timeout in
 *   milliseconds (defaults to 4000); other fields are forwarded to `fetch`.
 * @param json - Whether to parse and return the JSON body. Defaults to `true`;
 *   pass `false` to receive the raw `Response`.
 * @returns A promise of the parsed body (`T`) or the `Response`, per `S`.
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
                // A non-JSON error body (HTML error page, empty) must not
                // replace the real failure with a SyntaxError — fall back to
                // throwing the Response so callers keep the status.
                throw await response.json().catch(() => response);
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
