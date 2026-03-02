import { defineInstrumentation } from 'solidstep/utils/instrumentation';

export default defineInstrumentation({
    async register() {
        // Called once at server startup.
        // Initialize your telemetry SDK here (e.g., OpenTelemetry, Sentry).
        console.log('[instrumentation] Server starting...');
    },

    async onRequest(request, context) {
        // Called before each request is processed.
        // context.metadata is a mutable object you can use to pass data between hooks.
        context.metadata.requestId = crypto.randomUUID();
        console.log(
            `[instrumentation] ${request.method} ${context.pathname} (${context.routeType})`,
        );
    },

    async onResponseEnd(request, context) {
        // Called after the response stream is complete.
        console.log(
            `[instrumentation] ${context.statusCode} ${context.pathname} ${context.duration.toFixed(1)}ms`,
        );
    },

    async onRequestError(error, request, context) {
        // Called when an unhandled error occurs during request processing.
        console.error(
            `[instrumentation] Error in ${context.pathname}:`,
            error.message,
        );
    },
});
