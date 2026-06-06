'use server';

export async function adjust(prev: { count: number }, formData: FormData) {
    const raw = formData.get('step');
    const step = Number(raw);
    if (Number.isNaN(step)) {
        throw new Error('step must be a number');
    }
    return { count: prev.count + step };
}
