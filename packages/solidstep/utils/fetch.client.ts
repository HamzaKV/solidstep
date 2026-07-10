export type FetchResponse<T, S extends boolean> = S extends true ? T : Response;

type Options = {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    body?: any;
    headers?: any;
    MAX_FETCH_TIME?: number;
    serverAction?: boolean;
};

/**
 * A wrapper around the native `fetch` that adds an abort timeout and optional
 * JSON parsing (client/browser build).
 *
 * Responses with a 4xx/5xx status are thrown: as the parsed JSON body when
 * `json` is `true`, otherwise as the raw `Response`. When `json` is `true`, a
 * successful body containing an `error` field is also thrown (to handle errors
 * returned under a 200 status). An aborted request (timeout) throws
 * `Error('Timeout')`. If `options.serverAction` is set, caught errors are
 * returned rather than rethrown.
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
            const data = await response.json();

            if (data) {
                if (data.error) throw data.error; // in case the status is marked as 200 but the response is an error
                return data as FetchResponse<T, S>;
            }

            throw new Error('Not Defined');
        }

        return response as FetchResponse<T, S>;
    } catch (error) {
        // A timed-out request is still just "an error" from serverAction's
        // point of view — it must follow the same return-not-throw contract
        // as every other caught error, not bypass it.
        const finalError = controller.signal.aborted
            ? new Error('Timeout')
            : error;
        if (options?.serverAction) {
            return finalError as FetchResponse<T, S>;
        }
        throw finalError;
    } finally {
        clearTimeout(timeout);
    }
};

export default Fetch;
