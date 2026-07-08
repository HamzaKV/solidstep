import { describe, it, expect } from 'vitest';
import { timingSafeEqualString } from '../utils/crypto';

describe('timingSafeEqualString', () => {
    it('returns true for equal strings', () => {
        expect(timingSafeEqualString('secret-token', 'secret-token')).toBe(
            true,
        );
    });

    it('returns false for different strings of the same length', () => {
        expect(timingSafeEqualString('secret-token', 'wrong-token!')).toBe(
            false,
        );
    });

    it('returns false for strings of different lengths, without throwing', () => {
        expect(timingSafeEqualString('short', 'a-much-longer-string')).toBe(
            false,
        );
    });
});
