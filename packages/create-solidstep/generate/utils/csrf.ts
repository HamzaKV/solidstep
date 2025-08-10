const SAFE_METHODS = ['GET', 'OPTIONS', 'HEAD', 'TRACE'];

export const csrf = (trustedOrigins: string[]) => 
    (
        requestMethod: string,
        requestUrl: URL, 
        origin?: string, 
        referer?: string
    ) => {
        // Check if the request method is safe
        if (!SAFE_METHODS.includes(requestMethod)) {
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
