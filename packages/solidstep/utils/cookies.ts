import {
    setCookie as baseSetCookie,
    getCookie as baseGetCookie,
    deleteCookie as baseDeleteCookie,
    getEvent,
} from 'vinxi/http';

/**
 * Read a cookie from the current request.
 *
 * @param key - Cookie name.
 * @returns The cookie value, or `undefined` if not set.
 */
export const getCookie = (key: string): string | undefined => {
    const event = getEvent();
    return baseGetCookie(event, key);
};

/**
 * Set a cookie on the current response.
 *
 * @param key - Cookie name.
 * @param value - Cookie value.
 * @param options - Optional cookie serialization options (e.g. `maxAge`,
 *   `httpOnly`, `secure`, `sameSite`), forwarded to the underlying H3 helper.
 */
export const setCookie = (
    key: string,
    value: string,
    options?: Parameters<typeof baseSetCookie>[2],
) => {
    const event = getEvent();
    return baseSetCookie(event, key, value, options);
};

/**
 * Delete a cookie on the current response.
 *
 * @param key - Cookie name to clear.
 */
export const deleteCookie = (key: string) => {
    const event = getEvent();
    return baseDeleteCookie(event, key);
};
