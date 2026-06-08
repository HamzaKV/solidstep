/**
 * Create a CORS header resolver bound to an allowlist of origins.
 *
 * The returned function takes a request `origin` and whether the request is a
 * preflight (`OPTIONS`). For a trusted origin it returns the appropriate
 * `Access-Control-Allow-*` headers — the full set (origin, methods, headers)
 * for preflight requests, or just the allowed origin otherwise. Untrusted
 * origins yield an empty object (no CORS headers).
 *
 * @param trustedOrigins - Origins allowed to make cross-origin requests.
 * @param allowMethods - Methods advertised in preflight responses. Defaults to
 *   the common verbs (GET, POST, PUT, PATCH, DELETE, OPTIONS).
 * @param allowHeaders - Headers advertised in preflight responses. Defaults to
 *   `Content-Type` and `Authorization`.
 * @returns A `(origin, isPreflight) => Record<string, string>` resolver.
 */
export const cors =
    (
        trustedOrigins: string[],
        allowMethods: string[] = [
            'GET',
            'POST',
            'PUT',
            'PATCH',
            'DELETE',
            'OPTIONS',
        ],
        allowHeaders: string[] = ['Content-Type', 'Authorization'],
    ) =>
    (origin: string, isPreflight: boolean) => {
        if (trustedOrigins.includes(origin)) {
            if (isPreflight) {
                return {
                    'Access-Control-Allow-Origin': origin,
                    'Access-Control-Allow-Methods': allowMethods.join(', '),
                    'Access-Control-Allow-Headers': allowHeaders.join(', '),
                };
            }
            return {
                'Access-Control-Allow-Origin': origin,
            };
        }
        return {};
    };
