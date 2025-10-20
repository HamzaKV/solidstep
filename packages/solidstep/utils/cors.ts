
export const cors = (
    trustedOrigins: string[],
    allowMethods: string[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: string[] = ['Content-Type', 'Authorization']
) => (origin: string, isPreflight: boolean) => {
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
}
