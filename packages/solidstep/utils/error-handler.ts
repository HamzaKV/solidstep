export type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical';

export type AppError<Code extends string = string> = {
    code: Code;
    message: string;
    severity: ErrorSeverity;
    metadata?: Record<string, unknown>;
    cause?: unknown;
    action: (error?: AppError<Code>) => void | Promise<void>;
};

export type ErrorDefinition<Code extends string> = {
    message: string;
    severity: ErrorSeverity;
    defaultMetadata?: Record<string, unknown>;
    action?: (error: AppError<Code>) => void | Promise<void>;
};

export type ErrorCatalog<Code extends string = string> = {
    [K in Code]: ErrorDefinition<K>;
};

type CreateErrorOptions<Code extends string> = Partial<
    Pick<
        AppError<Code>,
        'message' | 'severity' | 'metadata' | 'cause' | 'action'
    >
>;

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
