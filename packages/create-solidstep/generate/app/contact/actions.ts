'use server';

export type ContactState = { sent: boolean; name?: string };

// A type-safe server function. Called over the network from the client; the
// `'use server'` directive keeps its body (and imports) off the browser bundle.
export async function sendMessage(
    _prev: ContactState,
    formData: FormData,
): Promise<ContactState> {
    const name = String(formData.get('name') ?? '').trim();
    // In a real app you'd persist or email here. We just echo it back.
    return { sent: true, name };
}
