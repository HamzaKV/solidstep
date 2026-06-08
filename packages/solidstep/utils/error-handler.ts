/** Severity level attached to an application error. */
export type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical';

/**
 * Shape of a structured application error, keyed by a string `code`.
 *
 * @typeParam Code - Union of valid error codes for the catalog.
 */
export type AppError<Code extends string = string> = {
    code: Code;
    message: string;
    severity: ErrorSeverity;
    metadata?: Record<string, unknown>;
    cause?: unknown;
    action: (error?: AppError<Code>) => void | Promise<void>;
};

/** A single entry in an {@link ErrorCatalog}, defining defaults for a code. */
export type ErrorDefinition<Code extends string> = {
    message: string;
    severity: ErrorSeverity;
    defaultMetadata?: Record<string, unknown>;
    action?: (error: AppError<Code>) => void | Promise<void>;
};

/**
 * A map of error codes to their {@link ErrorDefinition}. Pass one to
 * {@link createErrorFactory} to derive a typed error constructor.
 */
export type ErrorCatalog<Code extends string = string> = {
    [K in Code]: ErrorDefinition<K>;
};

type CreateErrorOptions<Code extends string> = Partial<
    Pick<
        AppError<Code>,
        'message' | 'severity' | 'metadata' | 'cause' | 'action'
    >
>;

/**
 * Concrete {@link AppError} implementation that also extends the native
 * `Error` (so it can be thrown and matched with `instanceof`).
 *
 * Carries a `code`, `severity`, optional `metadata`/`cause`, and an `action`
 * callback that is bound to the error instance and invoked with no arguments.
 *
 * @typeParam Code - Union of valid error codes.
 */
export class FunctionalAppError<Code extends string = string>
    extends Error
    implements AppError<Code>
{
    readonly code: Code;
    readonly severity: ErrorSeverity;
    readonly metadata?: Record<string, unknown>;
    readonly cause?: unknown;
    readonly action: () => void;

    constructor(params: {
        code: Code;
        message: string;
        severity: ErrorSeverity;
        metadata?: Record<string, unknown>;
        cause?: unknown;
        action: (error: AppError<Code>) => void;
    }) {
        super(params.message);
        this.name = 'AppError';
        this.code = params.code;
        this.severity = params.severity;
        this.metadata = params.metadata;
        this.cause = params.cause;

        // 👇 wrap action to pass this instance
        this.action = () => params.action(this);

        // ✅ Restore native error prototype chain (important for `instanceof`)
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

/**
 * Build a typed error factory from a catalog of error definitions.
 *
 * The returned function takes a known `code` plus optional per-call overrides
 * and produces a {@link FunctionalAppError}. Message, severity, and metadata
 * fall back to the catalog defaults (metadata is merged). The `action`
 * resolves to the override, then the catalog default, then a console.error
 * fallback.
 *
 * @param catalog - Map of error codes to their definitions.
 * @returns A `(code, overrides?) => FunctionalAppError` constructor.
 *
 * @example
 * ```ts
 * const createError = createErrorFactory({
 *   NOT_FOUND: { message: 'Not found', severity: 'low' },
 * });
 * throw createError('NOT_FOUND', { metadata: { id } });
 * ```
 */
export const createErrorFactory = <Code extends string>(
    catalog: ErrorCatalog<Code>,
) => {
    return (
        code: Code,
        overrides: CreateErrorOptions<Code> = {},
    ): FunctionalAppError<Code> => {
        const def = catalog[code];

        const actionFn =
            overrides.action ??
            def.action ??
            ((error: AppError<Code>) => {
                console.error(
                    `[Unhandled Error]: ${error.code} - ${error.message}`,
                );
            });

        return new FunctionalAppError({
            code,
            message: overrides.message ?? def.message,
            severity: overrides.severity ?? def.severity,
            metadata: {
                ...def.defaultMetadata,
                ...overrides.metadata,
            },
            cause: overrides.cause,
            action: actionFn,
        });
    };
};
