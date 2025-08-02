import { isServer } from 'solid-js/web';

export class RedirectError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RedirectError';
    }
}

export const redirect = (url: string) => {
    if (isServer) {
        throw new RedirectError(url);
    } else {
        window.location.href = url;
    }
};
