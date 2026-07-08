import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const getCookie = vi.fn();
const setSecureCookie = vi.fn();
const deleteCookie = vi.fn();

vi.mock('../utils/cookies.js', () => ({
    getCookie: (...a: unknown[]) => getCookie(...a),
    setSecureCookie: (...a: unknown[]) => setSecureCookie(...a),
    deleteCookie: (...a: unknown[]) => deleteCookie(...a),
}));

const ORIGINAL_SECRET = process.env.SOLIDSTEP_PREVIEW_SECRET;

describe('preview mode', () => {
    beforeEach(() => {
        vi.resetModules();
        getCookie.mockReset();
        setSecureCookie.mockReset();
        deleteCookie.mockReset();
        process.env.SOLIDSTEP_PREVIEW_SECRET = 'the-preview-secret';
    });

    afterEach(() => {
        process.env.SOLIDSTEP_PREVIEW_SECRET = ORIGINAL_SECRET;
    });

    describe('enablePreview', () => {
        it('sets a signed cookie', async () => {
            const { enablePreview } = await import('../utils/preview');
            enablePreview();
            expect(setSecureCookie).toHaveBeenCalledTimes(1);
            const [name, value] = setSecureCookie.mock.calls[0];
            expect(name).toBe('solidstep_preview');
            expect(value).toContain('.');
        });

        it('throws when SOLIDSTEP_PREVIEW_SECRET is unset', async () => {
            delete process.env.SOLIDSTEP_PREVIEW_SECRET;
            const { enablePreview } = await import('../utils/preview');
            expect(() => enablePreview()).toThrow();
            expect(setSecureCookie).not.toHaveBeenCalled();
        });
    });

    describe('disablePreview', () => {
        it('deletes the preview cookie', async () => {
            const { disablePreview } = await import('../utils/preview');
            disablePreview();
            expect(deleteCookie).toHaveBeenCalledWith('solidstep_preview');
        });
    });

    describe('isPreviewActive', () => {
        it('returns true for a cookie signed with the current secret', async () => {
            const { enablePreview, isPreviewActive } = await import(
                '../utils/preview'
            );
            enablePreview();
            const signedValue = setSecureCookie.mock.calls[0][1] as string;
            getCookie.mockReturnValue(signedValue);

            expect(isPreviewActive()).toBe(true);
        });

        it('returns false when no cookie is set', async () => {
            const { isPreviewActive } = await import('../utils/preview');
            getCookie.mockReturnValue(undefined);
            expect(isPreviewActive()).toBe(false);
        });

        it('returns false for a tampered cookie value', async () => {
            const { enablePreview, isPreviewActive } = await import(
                '../utils/preview'
            );
            enablePreview();
            const signedValue = setSecureCookie.mock.calls[0][1] as string;
            const [payload] = signedValue.split('.');
            getCookie.mockReturnValue(`${payload}.tampered-signature`);

            expect(isPreviewActive()).toBe(false);
        });

        it('returns false for a cookie signed with a different secret', async () => {
            const { enablePreview, isPreviewActive } = await import(
                '../utils/preview'
            );
            enablePreview();
            const signedValue = setSecureCookie.mock.calls[0][1] as string;

            process.env.SOLIDSTEP_PREVIEW_SECRET = 'a-different-secret';
            getCookie.mockReturnValue(signedValue);

            expect(isPreviewActive()).toBe(false);
        });

        it('returns false for a cookie with the wrong payload marker', async () => {
            const { isPreviewActive } = await import('../utils/preview');
            getCookie.mockReturnValue('not-the-expected-payload.somesignature');
            expect(isPreviewActive()).toBe(false);
        });

        it('returns false for a cookie with no signature part', async () => {
            const { isPreviewActive } = await import('../utils/preview');
            getCookie.mockReturnValue('active');
            expect(isPreviewActive()).toBe(false);
        });

        it('returns false when SOLIDSTEP_PREVIEW_SECRET is unset, even with a cookie present', async () => {
            const { enablePreview, isPreviewActive } = await import(
                '../utils/preview'
            );
            enablePreview();
            const signedValue = setSecureCookie.mock.calls[0][1] as string;
            getCookie.mockReturnValue(signedValue);

            delete process.env.SOLIDSTEP_PREVIEW_SECRET;
            expect(isPreviewActive()).toBe(false);
        });
    });
});
