'use server';

import { invalidateTag, revalidatePath } from 'solidstep/utils/cache';

export type RevalidateState = { revalidations: number };

/**
 * Drop every cache entry tagged `products` (here, this page's loader data),
 * then revalidate the page so its server-rendered HTML is refreshed and diffed
 * back into the live DOM as a single-flight mutation.
 */
export async function revalidateProducts(
    prev: RevalidateState,
): Promise<RevalidateState> {
    await invalidateTag('products');
    revalidatePath('/cache-tags');
    return { revalidations: prev.revalidations + 1 };
}
