import { isServer } from 'solid-js/web';

/** HTTP status codes a redirect may carry. */
export type RedirectStatus = 301 | 302 | 303 | 307 | 308;

/**
 * Error thrown on the server to signal a redirect. The `message` carries the
 * target URL and `status` the HTTP status; the framework catches it and
 * issues the redirect response.
 */
export class RedirectError extends Error {
    readonly status: RedirectStatus;
    constructor(message: string, status: RedirectStatus = 302) {
        super(message);
        this.name = 'RedirectError';
        this.status = status;
    }
}

/**
 * Redirect to another URL.
 *
 * On the server this throws a {@link RedirectError} (caught by the framework
 * to emit a redirect response). On the client it navigates by setting
 * `window.location.href`.
 *
 * @param url - The destination URL.
 * @param status - HTTP redirect status. Defaults to 302; use 307/308 to
 *   preserve the request method, 301/308 for permanent moves. Ignored on the
 *   client (a client-side redirect is just a navigation).
 * @throws {RedirectError} On the server, to trigger the redirect.
 */
export const redirect = (url: string, status: RedirectStatus = 302) => {
    if (isServer) {
        throw new RedirectError(url, status);
    }
    window.location.href = url;
    return;
};

/**
 * Decide whether `url` is a safe redirect target, guarding against open-redirect
 * (and `javascript:`/`data:`) abuse when the destination is derived from user
 * input (a `?next=` param, a form field, etc.).
 *
 * Safe targets are:
 * - same-site **relative** paths (`/dashboard`, `/a?b=c`) — but NOT
 *   protocol-relative URLs (`//evil.com`) or their backslash variants, which
 *   browsers treat as absolute;
 * - absolute `http(s)` URLs whose host is explicitly listed in `allowedHosts`.
 *
 * Everything else (other-origin URLs, non-http(s) schemes, malformed input) is
 * rejected.
 *
 * @param url - The candidate destination.
 * @param allowedHosts - Hosts (e.g. `auth.example.com`) permitted as absolute
 *   redirect targets. Defaults to none, so only relative paths pass.
 */
export const isSafeRedirectTarget = (
    url: string,
    allowedHosts: string[] = [],
): boolean => {
    if (typeof url !== 'string' || url.length === 0) return false;
    // The WHATWG URL parser (what `window.location.href =` actually uses)
    // strips ASCII tab/CR/LF from anywhere in the string before parsing, so
    // e.g. "/\t/evil.com" would resolve to "https://evil.com/" despite not
    // literally starting with "//" — reject any control character outright.
    // biome-ignore lint/suspicious/noControlCharactersInRegex: detecting them is the point
    if (/[\x00-\x1f]/.test(url)) return false;
    // Protocol-relative ("//evil.com") and backslash variants are absolute to
    // the browser despite starting with a slash — reject them.
    if (/^[/\\]{2}/.test(url)) return false;
    // Same-site relative path.
    if (url.startsWith('/')) return true;
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return false;
        }
        return allowedHosts.includes(parsed.host);
    } catch {
        return false;
    }
};

/**
 * Like {@link redirect}, but only redirects when `url` passes
 * {@link isSafeRedirectTarget}; otherwise it redirects to `fallback` (default
 * `'/'`). Use this whenever the destination comes from untrusted input.
 *
 * @param url - The (possibly untrusted) destination URL.
 * @param options.allowedHosts - Hosts permitted as absolute redirect targets.
 * @param options.fallback - Where to go when `url` is unsafe. Defaults to `'/'`.
 */
export const safeRedirect = (
    url: string,
    options?: { allowedHosts?: string[]; fallback?: string },
) =>
    redirect(
        isSafeRedirectTarget(url, options?.allowedHosts)
            ? url
            : (options?.fallback ?? '/'),
    );
