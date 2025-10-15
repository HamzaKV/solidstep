import { 
    setCookie as baseSetCookie, 
    getCookie as baseGetCookie,
    deleteCookie as baseDeleteCookie,
    getEvent 
} from 'vinxi/http';

export const getCookie = (key: string): string | undefined => {
    const event = getEvent();
    return baseGetCookie(event, key);
};

export const setCookie = (
    key: string, 
    value: string,
    options?: Parameters<typeof baseSetCookie>[2]
) => {
    const event = getEvent();
    return baseSetCookie(event, key, value, options);
}

export const deleteCookie = (key: string) => {
    const event = getEvent();
    return baseDeleteCookie(event, key);
};
