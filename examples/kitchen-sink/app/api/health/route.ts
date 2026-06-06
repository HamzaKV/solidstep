export async function GET(_request: Request) {
    return new Response(JSON.stringify({ status: 'ok', service: 'kitchen-sink' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}

export async function POST(request: Request) {
    const body = await request.json().catch(() => ({}));
    return new Response(JSON.stringify({ received: body }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}
