// Dedicated to the rate-limit/body-limit e2e coverage in
// tests/rate-body-limit.spec.ts. The actual 413/429 responses are produced
// by middleware (app/middleware.ts) before this handler ever runs; this just
// answers when a request gets through.
export async function POST(_request: Request) {
    return new Response('ok', { status: 200 });
}
