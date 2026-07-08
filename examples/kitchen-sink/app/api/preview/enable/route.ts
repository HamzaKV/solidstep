import { enablePreview } from 'solidstep/utils/preview';

export async function POST(_request: Request) {
    enablePreview();
    return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}
