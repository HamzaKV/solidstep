import { createHmac } from 'node:crypto';
import { getCookie, setSecureCookie, deleteCookie } from './cookies.js';
import { timingSafeEqualString } from './crypto.js';

const COOKIE_NAME = 'solidstep_preview';
const PAYLOAD = 'active';

const requireSecret = (): string => {
    const secret = process.env.SOLIDSTEP_PREVIEW_SECRET;
    if (!secret) {
        throw new Error(
            'Preview mode requires SOLIDSTEP_PREVIEW_SECRET to be set.',
        );
    }
    return secret;
};

const sign = (secret: string): string =>
    createHmac('sha256', secret).update(PAYLOAD).digest('hex');

/**
 * Enable preview mode for the current visitor: sets an HMAC-signed cookie
 * that {@link isPreviewActive} verifies on later requests. Bypasses (never
 * writes to) ISR/page-cache/loader-cache reads while active — see the
 * "Preview mode" section of `docs/caching.md`.
 *
 * @throws {Error} When `SOLIDSTEP_PREVIEW_SECRET` is unset.
 */
export const enablePreview = (): void => {
    const secret = requireSecret();
    setSecureCookie(COOKIE_NAME, `${PAYLOAD}.${sign(secret)}`, {
        maxAge: 60 * 60,
    });
};

/** Clear the preview cookie set by {@link enablePreview}. */
export const disablePreview = (): void => {
    deleteCookie(COOKIE_NAME);
};

/**
 * Whether preview mode is active for the current request: a preview cookie
 * is present and its signature verifies against `SOLIDSTEP_PREVIEW_SECRET`.
 * Always `false` when the secret is unset (even with a cookie present) or the
 * cookie is missing, malformed, or signed with a different/no-longer-valid
 * secret.
 */
export const isPreviewActive = (): boolean => {
    const secret = process.env.SOLIDSTEP_PREVIEW_SECRET;
    if (!secret) return false;

    const value = getCookie(COOKIE_NAME);
    if (!value) return false;

    const [payload, signature] = value.split('.');
    if (payload !== PAYLOAD || !signature) return false;

    return timingSafeEqualString(signature, sign(secret));
};
