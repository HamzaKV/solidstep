// utils/instrumentation.ts
// Instrumentation types, helpers, and loader for SolidStep telemetry
// Instrumentation types, helpers, and loader for SolidStep telemetry

// ============================================
// Types
// ============================================

export interface RequestContext {
    /** The matched route path pattern (e.g., "/posts/[id]") */
    routePath: string;
    /** The actual URL pathname (e.g., "/posts/123") */
    pathname: string;
    /** Type of route being handled */
    routeType: 'page' | 'api' | 'static' | 'not-found' | 'error' | 'server-action' | 'unknown';
    /** Route parameters extracted from the path */
    params: Record<string, string | string[]>;
    /** URL search parameters */
    searchParams: Record<string, string>;
    /** High-resolution timestamp when request started */
    startTime: number;
    /** Custom metadata attached to the request */
    metadata: Record<string, unknown>;
    /** Unix timestamp (milliseconds) when request started */
    startTimeEpoch: number;
}

export interface ResponseContext extends RequestContext {
    /** HTTP status code */
    statusCode: number;
    /** Duration in milliseconds since request started */
    duration: number;
}

export interface ServerInfo {
    /** Full server URL (e.g., "http://localhost:3001") */
    url: string;
    /** Port number */
    port: number;
    /** Host (e.g., "localhost" or "0.0.0.0") */
    host: string;
    /** Current environment */
    env: 'development' | 'production';
}

// ============================================
// Hook Function Types
// ============================================

/** Called once during server startup. Errors will prevent server from starting. */
export type RegisterFn = () => void | Promise<void>;

/** Called before each request is processed */
export type OnRequestFn = (
    request: Request,
    context: RequestContext,
) => void | Promise<void>;

/** Called when response is ready but before streaming starts */
export type OnResponseStartFn = (
    request: Request,
    response: Response,
    context: ResponseContext,
) => void | Promise<void>;

/** Called after response stream is complete */
export type OnResponseEndFn = (
    request: Request,
    context: ResponseContext,
) => void | Promise<void>;

/** Called when server is fully ready and listening */
export type OnServerReadyFn = (server: ServerInfo) => void | Promise<void>;

/** Called when server is shutting down */
export type OnShutdownFn = () => void | Promise<void>;

/** Called when an error occurs during request processing */
export type OnRequestErrorFn = (
    error: Error,
    context: RequestContext,
) => void | Promise<void>;

// ============================================
// Instrumentation Module Interface
// ============================================

export interface InstrumentationModule {
    register?: RegisterFn;
    onRequest?: OnRequestFn;
    onResponseStart?: OnResponseStartFn;
    onResponseEnd?: OnResponseEndFn;
    onServerReady?: OnServerReadyFn;
    onShutdown?: OnShutdownFn;
    onRequestError?: OnRequestErrorFn;
}

// ============================================
// Helper for Type-Safe Definition
// ============================================

/**
 * Define instrumentation with full type safety.
 *
 * @example
 * ```ts
 * // instrumentation.ts
 * import { defineInstrumentation } from './utils/instrumentation';
 *
 * export default defineInstrumentation({
 *   async register() {
 *     // Initialize telemetry
 *   },
 *   async onRequest(request, context) {
 *     console.log(`${request.method} ${context.pathname}`);
 *   },
 * });
 * ```
 */
export function defineInstrumentation(
    config: InstrumentationModule,
): InstrumentationModule {
    return config;
}

// ============================================
// Internal State & Loader
// ============================================

let instrumentationModule: InstrumentationModule | null = null;
let initPromise: Promise<InstrumentationModule | null> | null = null;
let initError: Error | null = null;

/**
 * Load the user's instrumentation module.
 * Called once during server startup.
 */
export async function loadInstrumentation(): Promise<InstrumentationModule | null> {
    if (initPromise) {
        return initPromise;
    }

    initPromise = (async () => {
        try {
            // This import is resolved at build time via alias
            // @ts-expect-error - resolved at build time by Vite alias
            const module = await import('instrumentation');

            // Support both default export and named exports
            if (module.default && typeof module.default === 'object') {
                instrumentationModule = module.default;
            } else {
                // Named exports
                instrumentationModule = {
                    register: module.register,
                    onRequest: module.onRequest,
                    onResponseStart: module.onResponseStart,
                    onResponseEnd: module.onResponseEnd,
                    onServerReady: module.onServerReady,
                    onShutdown: module.onShutdown,
                    onRequestError: module.onRequestError,
                };
            }

            return instrumentationModule;
        } catch (e: any) {
            // Check if it's a "module not found" error (no instrumentation file)
            if (
                e.code === 'ERR_MODULE_NOT_FOUND' ||
                e.message?.includes('Cannot find module')
            ) {
                return null;
            }
            // Re-throw other errors (syntax errors, etc.)
            initError = e;
            throw e;
        }
    })();

    try {
        return await initPromise;
    } catch (e) {
        if (initError) throw initError;
        throw e;
    }
}

/**
 * Get the loaded instrumentation module.
 * Returns null if not loaded or no instrumentation file exists.
 */
export function getInstrumentation(): InstrumentationModule | null {
    return instrumentationModule;
}

// ============================================
// Safe Hook Executors (for request lifecycle)
// ============================================

/**
 * Safely execute a hook, catching and logging any errors.
 * Used for request/response hooks where we don't want to fail the request.
 */
export async function safeExecuteHook<T extends (...args: any[]) => any>(
    hookName: string,
    hook: T | undefined,
    ...args: Parameters<T>
): Promise<void> {
    if (!hook) return;

    try {
        await hook(...args);
    } catch (error) {
        console.error(`[instrumentation] Error in ${hookName} hook:`, error);
    }
}

// ============================================
// Request Context Builder
// ============================================

export function createRequestContext(
    request: Request,
    overrides: Partial<RequestContext> = {},
): RequestContext {
    const url = new URL(request.url);

    return {
        routePath: 'unknown',
        pathname: url.pathname,
        routeType: 'unknown',
        params: {},
        searchParams: Object.fromEntries(url.searchParams),
        startTime: performance.now(),
        metadata: {},
        startTimeEpoch: Date.now(),
        ...overrides,
    };
}

export function createResponseContext(
    requestContext: RequestContext,
    statusCode: number,
): ResponseContext {
    return {
        ...requestContext,
        statusCode,
        duration: performance.now() - requestContext.startTime,
    };
}
