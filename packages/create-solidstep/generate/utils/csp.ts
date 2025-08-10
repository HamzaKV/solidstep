export const cspNonce = (nonce: string) => `
    default-src 'self';
    font-src 'self' https://fonts.gstatic.com;
    object-src 'none';
    base-uri 'none';
    frame-ancestors 'none';
    form-action 'self';
    style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
    style-src-elem 'self' 'unsafe-inline' https://fonts.googleapis.com;
    script-src 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval';
    connect-src 'self' ws:;
    img-src 'self' data:;
`.replace(/\s+/g, ' ');

export const csp = `
    default-src 'self';
    font-src 'self' https://fonts.gstatic.com;
    object-src 'none';
    base-uri 'none';
    frame-ancestors 'none';
    form-action 'self';
    style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
    style-src-elem 'self' 'unsafe-inline' https://fonts.googleapis.com;
    script-src 'self' 'unsafe-inline' 'unsafe-eval';
    connect-src 'self' ws:;
    img-src 'self' data:;
`.replace(/\s+/g, ' ');
