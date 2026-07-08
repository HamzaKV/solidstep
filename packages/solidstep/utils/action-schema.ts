import type { StandardSchemaV1 } from '@standard-schema/spec';

/**
 * Thrown by {@link parseActionInput} when a schema rejects its input. Carries
 * the schema's issues so a caller (e.g. `useActionState().error()`) can
 * surface field-level feedback.
 *
 * Errors cross the server-action wire via seroval, which does not preserve
 * custom `Error` subclasses — it reconstructs a plain `Error` with the
 * original's own-enumerable properties (including `name` and `issues`)
 * reassigned onto it. So on the client this is `.name === 'ValidationError'`
 * but **not** `instanceof ValidationError`; narrow on `.name`, matching this
 * codebase's existing `RedirectError` convention.
 */
export class ValidationError extends Error {
    issues: readonly StandardSchemaV1.Issue[];

    constructor(issues: readonly StandardSchemaV1.Issue[]) {
        super(issues[0]?.message ?? 'Validation failed');
        this.name = 'ValidationError';
        this.issues = issues;
    }
}

/** Whether `error` is a {@link ValidationError} — checks `.name`, not `instanceof` (see class doc). */
export const isValidationError = (
    error: unknown,
): error is ValidationError & { issues: readonly StandardSchemaV1.Issue[] } =>
    error instanceof Error && error.name === 'ValidationError';

/**
 * Coerce a `FormData` into a plain object: a single value per key stays a
 * scalar, repeated keys become an array. `File` values are kept as `File`.
 *
 * Built with `Object.create(null)`, not `{}` — a plain object literal
 * inherits `Object.prototype`'s `__proto__` accessor, so a form field
 * literally named `__proto__` (trivial for an attacker to submit directly,
 * bypassing any client-side form) would replace `result`'s own prototype
 * with the submitted value instead of storing it as a normal property
 * whenever that value is an object (e.g. a `File`) — silently exposing the
 * File's own properties (`name`, `type`, `size`, ...) through every other
 * field lookup on `result`.
 */
const formDataToObject = (formData: FormData): Record<string, unknown> => {
    const result: Record<string, unknown> = Object.create(null);
    for (const key of new Set(formData.keys())) {
        const values = formData.getAll(key);
        result[key] = values.length > 1 ? values : values[0];
    }
    return result;
};

/**
 * Coerce `formData` to a plain object and validate it against a Standard
 * Schema V1-compatible `schema` (Zod, Valibot, etc). Call this from inside
 * your own `'use server'` action — validation must run there to be
 * enforced; see {@link ValidationError}'s doc comment for why this isn't a
 * `defineAction`-style wrapper.
 *
 * @throws {ValidationError} When the schema rejects the input.
 */
export const parseActionInput = async <Schema extends StandardSchemaV1>(
    schema: Schema,
    formData: FormData,
): Promise<StandardSchemaV1.InferOutput<Schema>> => {
    const input = formDataToObject(formData);
    let result = schema['~standard'].validate(input);
    if (result instanceof Promise) result = await result;
    if (result.issues) {
        throw new ValidationError(result.issues);
    }
    if (!('value' in result)) {
        throw new Error(
            "Schema validation returned neither 'issues' nor 'value' -- this schema does not implement the Standard Schema V1 contract correctly.",
        );
    }
    return result.value;
};
