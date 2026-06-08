import { isServer } from 'solid-js/web';

/**
 * Error thrown on the server to signal a redirect. The `message` carries the
 * target URL; the framework catches it and issues the redirect response.
 */
export class RedirectError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RedirectError';
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
 * @throws {RedirectError} On the server, to trigger the redirect.
 */
export const redirect = (url: string) => {
    if (isServer) {
        throw new RedirectError(url);
    }
    window.location.href = url;
    return;
};
