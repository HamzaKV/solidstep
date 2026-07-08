'use server';

import { z } from 'zod';
import { parseActionInput } from 'solidstep/utils/action-schema';

const signupSchema = z.object({
    name: z.string().min(1, 'Name is required'),
    email: z.string().email('Enter a valid email'),
});

export type SignupState = { ok?: true; name?: string };

export async function signup(
    _prev: SignupState,
    formData: FormData,
): Promise<SignupState> {
    // Throws ValidationError (server-side, enforced regardless of client JS)
    // when the input doesn't match the schema.
    const input = await parseActionInput(signupSchema, formData);
    return { ok: true, name: input.name };
}
