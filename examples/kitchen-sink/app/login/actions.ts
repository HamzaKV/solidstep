'use server';

import { setCookie } from 'solidstep/utils/cookies';

type LoginState = { ok?: true; error?: string };

export async function authenticate(
    _prev: LoginState,
    formData: FormData,
): Promise<LoginState> {
    const username = String(formData.get('username') ?? '');
    const password = String(formData.get('password') ?? '');

    if (username !== 'demo' || password !== 'demo') {
        return { error: 'Invalid credentials' };
    }

    setCookie('session', `session-for-${username}`, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60,
    });

    return { ok: true };
}
