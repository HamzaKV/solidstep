import { disablePreview } from 'solidstep/utils/preview';

export async function POST(_request: Request) {
    disablePreview();
    return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}
