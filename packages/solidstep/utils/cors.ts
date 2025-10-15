
export const cors = (trustedOrigins: string[]) => (origin: string, isPreflight: boolean) => {
    if (trustedOrigins.includes(origin)) {
        if (isPreflight) {
            return {
                'Access-Control-Allow-Origin': origin,
                'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            };
        }
        return {
            'Access-Control-Allow-Origin': origin,
        };
    }
    return {};
}
