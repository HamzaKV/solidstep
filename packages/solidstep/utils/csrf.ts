const SAFE_METHODS = ['GET', 'OPTIONS', 'HEAD', 'TRACE'];

/**
 * Create a CSRF check bound to an allowlist of trusted origins.
 *
 * The returned function validates an incoming request: safe methods always
 * pass. For unsafe methods it verifies the `Origin` header against the request
 * origin and the allowlist; when no `Origin` is present over HTTPS it falls
 * back to strict `Referer` checks to guard against MITM.
 *
 * @param trustedOrigins - Hosts (e.g. `example.com`) permitted as cross-origin
 *   sources for state-changing requests.
 * @param safeMethods - Methods exempt from the check. Defaults to GET, OPTIONS,
 *   HEAD, and TRACE.
 * @returns A function `(requestMethod, requestUrl, origin?, referer?)` that
 *   returns `{ success, message }` — `success: false` on a failed check.
 */
export const csrf =
    (trustedOrigins: string[], safeMethods: string[] = SAFE_METHODS) =>
    (
        requestMethod: string,
        requestUrl: URL,
        origin?: string,
        referer?: string,
    ) => {
        // Check if the request method is safe
        if (!safeMethods.includes(requestMethod)) {
            // If we have an Origin header, check it against our allowlist.
            if (origin) {
                const parsedOrigin = new URL(origin);
                if (
                    parsedOrigin.origin !== requestUrl.origin &&
                    !trustedOrigins.includes(parsedOrigin.host)
                ) {
                    return {
                        success: false,
                        message: 'Invalid origin',
                    };
                }
            }

            // If we are serving via TLS and have no Origin header, prevent against
            // CSRF via HTTP man-in-the-middle attacks by enforcing strict Referer
            // origin checks.
            if (!origin && requestUrl.protocol === 'https:') {
                if (!referer) {
                    return {
                        success: false,
                        message: 'referer not supplied',
                    };
                }

                const parsedReferer = new URL(referer);

                if (parsedReferer.protocol !== 'https:') {
                    return {
                        success: false,
                        message: 'Invalid referer',
                    };
                }

                if (
                    parsedReferer.host !== requestUrl.host &&
                    !trustedOrigins.includes(parsedReferer.host)
                ) {
                    return {
                        success: false,
                        message: 'Invalid referer',
                    };
                }
            }
        }

        return {
            success: true,
            message: 'CSRF check passed',
        };
    };
