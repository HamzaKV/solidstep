import { describe, it, expect, vi } from 'vitest';
import {
    createErrorFactory,
    FunctionalAppError,
    type ErrorCatalog,
} from '../utils/error-handler';

type Codes = 'not-found' | 'auth-error' | 'db-error';

const catalog: ErrorCatalog<Codes> = {
    'not-found': {
        message: 'Resource not found',
        severity: 'medium',
    },
    'auth-error': {
        message: 'Authentication failed',
        severity: 'high',
        action: (error) => {
            throw new Error(`action called: ${error.code}`);
        },
    },
    'db-error': {
        message: 'Database error',
        severity: 'critical',
        defaultMetadata: { retryable: true },
    },
};

const createError = createErrorFactory(catalog);

describe('FunctionalAppError basics', () => {
    it('is an instance of Error', () => {
        const err = createError('not-found');
        expect(err).toBeInstanceOf(Error);
        expect(err).toBeInstanceOf(FunctionalAppError);
    });

    it('has the correct code', () => {
        expect(createError('not-found').code).toBe('not-found');
        expect(createError('auth-error').code).toBe('auth-error');
    });

    it('uses the catalog message', () => {
        expect(createError('not-found').message).toBe('Resource not found');
    });

    it('uses the catalog severity', () => {
        expect(createError('not-found').severity).toBe('medium');
        expect(createError('db-error').severity).toBe('critical');
    });

    it('sets name to AppError', () => {
        expect(createError('not-found').name).toBe('AppError');
    });
});

describe('default metadata', () => {
    it('includes defaultMetadata from catalog', () => {
        const err = createError('db-error');
        expect(err.metadata).toMatchObject({ retryable: true });
    });

    it('merges defaultMetadata with override metadata', () => {
        const err = createError('db-error', {
            metadata: { query: 'SELECT 1' },
        });
        expect(err.metadata).toMatchObject({
            retryable: true,
            query: 'SELECT 1',
        });
    });
});

describe('overrides', () => {
    it('overrides the message', () => {
        const err = createError('not-found', { message: 'Custom message' });
        expect(err.message).toBe('Custom message');
    });

    it('overrides the severity', () => {
        const err = createError('not-found', { severity: 'critical' });
        expect(err.severity).toBe('critical');
    });

    it('attaches cause', () => {
        const cause = new Error('original');
        const err = createError('db-error', { cause });
        expect(err.cause).toBe(cause);
    });
});

describe('action', () => {
    it('calls the catalog action when action() is invoked', () => {
        const err = createError('auth-error');
        expect(() => err.action()).toThrow('action called: auth-error');
    });

    it('calls a custom action override', () => {
        const customAction = vi.fn();
        const err = createError('not-found', { action: customAction });
        err.action();
        expect(customAction).toHaveBeenCalledWith(err);
    });

    it('uses a default console.error action when neither catalog nor override provides one', () => {
        const consoleSpy = vi
            .spyOn(console, 'error')
            .mockImplementation(() => {});
        const err = createError('not-found');
        err.action();
        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
    });
});

describe('instanceof checks', () => {
    it('can be caught as Error', () => {
        const err = createError('db-error');
        let caught: unknown;
        try {
            throw err;
        } catch (e) {
            caught = e;
        }
        expect(caught instanceof Error).toBe(true);
    });

    it('can be caught as FunctionalAppError', () => {
        const err = createError('db-error');
        let caught: unknown;
        try {
            throw err;
        } catch (e) {
            caught = e;
        }
        expect(caught instanceof FunctionalAppError).toBe(true);
    });
});
