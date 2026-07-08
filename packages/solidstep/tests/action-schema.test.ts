import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import {
    parseActionInput,
    ValidationError,
    isValidationError,
} from '../utils/action-schema';

/** A minimal Standard Schema V1 whose `validate` returns a Promise, unlike
 * zod's (which resolves synchronously for these simple schemas) -- exercises
 * `parseActionInput`'s async-validator branch. */
const asyncUppercaseSchema: StandardSchemaV1<
    Record<string, unknown>,
    { name: string }
> = {
    '~standard': {
        version: 1,
        vendor: 'test',
        async validate(value) {
            const name = (value as { name?: unknown }).name;
            if (typeof name !== 'string' || name !== name.toUpperCase()) {
                return { issues: [{ message: 'name must be uppercase' }] };
            }
            return { value: { name } };
        },
    },
};

/** A non-compliant Standard Schema whose validate() returns neither
 * `{issues}` nor `{value}` -- simulates a buggy/misbehaving schema. */
const nonCompliantSchema: StandardSchemaV1<Record<string, unknown>, unknown> = {
    '~standard': {
        version: 1,
        vendor: 'test',
        // biome-ignore lint/suspicious/noExplicitAny: deliberately non-compliant return shape for the test.
        validate: () => ({}) as any,
    },
};

/** A schema whose validate() throws synchronously (non-async, non-Promise)
 * instead of returning `{issues}` -- simulates a misbehaving schema that
 * doesn't follow the Standard Schema contract at all. */
const throwingSchema: StandardSchemaV1<Record<string, unknown>, unknown> = {
    '~standard': {
        version: 1,
        vendor: 'test',
        validate: () => {
            throw new Error('schema blew up');
        },
    },
};

describe('parseActionInput', () => {
    it('returns the schema-validated value for valid FormData', async () => {
        const schema = z.object({ name: z.string(), age: z.coerce.number() });
        const formData = new FormData();
        formData.set('name', 'Ada');
        formData.set('age', '36');

        const result = await parseActionInput(schema, formData);

        expect(result).toEqual({ name: 'Ada', age: 36 });
    });

    it('throws a ValidationError carrying the schema issues for invalid FormData', async () => {
        const schema = z.object({
            name: z.string().min(1),
            age: z.coerce.number(),
        });
        const formData = new FormData();
        formData.set('name', '');
        formData.set('age', 'not-a-number');

        await expect(parseActionInput(schema, formData)).rejects.toSatisfy(
            (err: unknown) => {
                expect(err).toBeInstanceOf(ValidationError);
                const validationError = err as ValidationError;
                expect(validationError.name).toBe('ValidationError');
                expect(validationError.issues.length).toBeGreaterThan(0);
                return true;
            },
        );
    });

    it('coerces repeated FormData keys into an array', async () => {
        const schema = z.object({ tags: z.array(z.string()) });
        const formData = new FormData();
        formData.append('tags', 'a');
        formData.append('tags', 'b');

        const result = await parseActionInput(schema, formData);

        expect(result).toEqual({ tags: ['a', 'b'] });
    });

    it('keeps File values as File, not coerced to a string', async () => {
        const schema = z.object({ upload: z.instanceof(File) });
        const formData = new FormData();
        const file = new File(['contents'], 'test.txt', { type: 'text/plain' });
        formData.set('upload', file);

        const result = await parseActionInput(schema, formData);

        expect(result.upload).toBeInstanceOf(File);
        expect(result.upload.name).toBe('test.txt');
    });

    it('awaits an async Standard Schema validator', async () => {
        const formData = new FormData();
        formData.set('name', 'ADA');

        const result = await parseActionInput(asyncUppercaseSchema, formData);

        expect(result).toEqual({ name: 'ADA' });
    });

    it('throws when a non-compliant schema returns neither issues nor value, instead of silently succeeding with undefined', async () => {
        const formData = new FormData();
        formData.set('name', 'anything');

        await expect(
            parseActionInput(nonCompliantSchema, formData),
        ).rejects.toThrow();
    });

    it("propagates a synchronously-throwing schema's raw error, not masquerading as ValidationError", async () => {
        // Pins current (already-correct) behavior: a schema that doesn't
        // follow the Standard Schema contract at all (throws instead of
        // returning {issues}) fails loudly with its own error, rather than
        // being swallowed or silently reported as a ValidationError -- so a
        // future refactor can't accidentally start masking this class of bug.
        const formData = new FormData();
        formData.set('name', 'anything');

        let caught: unknown;
        try {
            await parseActionInput(throwingSchema, formData);
        } catch (e) {
            caught = e;
        }
        expect(caught).toBeInstanceOf(Error);
        expect((caught as Error).message).toBe('schema blew up');
        expect(isValidationError(caught)).toBe(false);
    });

    it('throws ValidationError when an async validator rejects the input', async () => {
        const formData = new FormData();
        formData.set('name', 'ada');

        await expect(
            parseActionInput(asyncUppercaseSchema, formData),
        ).rejects.toThrow(ValidationError);
    });
});

describe('ValidationError', () => {
    it('falls back to a generic message when constructed with no issues', () => {
        const err = new ValidationError([]);
        expect(err.message).toBe('Validation failed');
    });
});

describe('isValidationError', () => {
    it('narrows a plain Error carrying name "ValidationError" (post-seroval shape)', () => {
        // Seroval reconstructs a plain Error with own-enumerable properties
        // reassigned, not a real ValidationError instance -- narrowing must
        // work on that reconstructed shape, not just a real instance.
        const reconstructed = Object.assign(new Error('bad input'), {
            name: 'ValidationError',
            issues: [{ message: 'bad input' }],
        });

        expect(isValidationError(reconstructed)).toBe(true);
        expect(reconstructed).not.toBeInstanceOf(ValidationError);
    });

    it('rejects a real ValidationError instance too', () => {
        const err = new ValidationError([{ message: 'bad input' }]);
        expect(isValidationError(err)).toBe(true);
    });

    it('returns false for an unrelated error', () => {
        expect(isValidationError(new Error('boom'))).toBe(false);
        expect(isValidationError('not an error')).toBe(false);
        expect(isValidationError(undefined)).toBe(false);
    });
});
