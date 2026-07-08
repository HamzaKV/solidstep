import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Constant-time string comparison, safe for comparing secrets (tokens, HMAC
 * signatures) without leaking their value through response-time differences.
 *
 * `node:crypto`'s `timingSafeEqual` throws when given buffers of different
 * lengths, which would itself leak length via a thrown-vs-not branch — both
 * inputs are hashed to a fixed length first so the comparison is always
 * constant-time regardless of the original strings' lengths.
 */
export const timingSafeEqualString = (a: string, b: string): boolean => {
    const hashA = createHash('sha256').update(a).digest();
    const hashB = createHash('sha256').update(b).digest();
    return timingSafeEqual(hashA, hashB);
};
