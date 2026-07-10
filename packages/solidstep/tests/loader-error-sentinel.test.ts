import { describe, it, expect } from 'vitest';
import {
    isLoaderErrorSentinel,
    LOADER_ERROR_KEY,
} from '../utils/loader-error-sentinel';

describe('isLoaderErrorSentinel', () => {
    it('recognizes a valid sentinel', () => {
        expect(isLoaderErrorSentinel({ [LOADER_ERROR_KEY]: 'db down' })).toBe(
            true,
        );
    });

    it('rejects ordinary loader data, even with a similarly-named key', () => {
        expect(isLoaderErrorSentinel({ posts: [] })).toBe(false);
        expect(isLoaderErrorSentinel({ [LOADER_ERROR_KEY]: 42 })).toBe(false);
    });

    it('rejects non-objects', () => {
        expect(isLoaderErrorSentinel(null)).toBe(false);
        expect(isLoaderErrorSentinel(undefined)).toBe(false);
        expect(isLoaderErrorSentinel('str')).toBe(false);
    });
});
