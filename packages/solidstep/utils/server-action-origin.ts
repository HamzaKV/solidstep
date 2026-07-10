/**
 * Default CSRF protection for server functions: verify the request's
 * `Origin`/`Sec-Fetch-Site` against the request's own origin (plus any
 * configured `trustedOrigins`). Absent both headers (non-browser clients —
 * curl, mobile apps, server-to-server calls), the check passes: those
 * clients never send them, and a browser making a cross-origin request
 * always sends at least one.
 */
export function isTrustedServerActionOrigin(
    request: Request,
    url: URL,
    trustedOrigins: string[] = [],
): boolean {
    const secFetchSite = request.headers.get('Sec-Fetch-Site');
    const origin = request.headers.get('Origin');

    if (!origin && !secFetchSite) return true;
    if (secFetchSite === 'same-origin' || secFetchSite === 'none') return true;

    if (origin) {
        try {
            const parsedOrigin = new URL(origin);
            if (parsedOrigin.origin === url.origin) return true;
            // Accept either a bare host (`app.example.com`) or a full origin
            // (`https://app.example.com`) entry, case-insensitively — matching
            // cors.ts/csrf.ts so one allowlist value works across all three.
            const host = parsedOrigin.host.toLowerCase();
            const fullOrigin = parsedOrigin.origin.toLowerCase();
            return trustedOrigins.some((entry) => {
                const trusted = entry.toLowerCase();
                return trusted === host || trusted === fullOrigin;
            });
        } catch {
            return false;
        }
    }

    return false;
}
