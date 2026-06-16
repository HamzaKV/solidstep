# Instrumentation

[← Back to docs index](./README.md)

SolidStep provides a server-side instrumentation API for observability, telemetry, and error tracking. Create an `app/instrumentation.ts` file to hook into the request lifecycle — no configuration required.

```tsx
// app/instrumentation.ts
import { defineInstrumentation } from 'solidstep/utils/instrumentation';

export default defineInstrumentation({
  async register() {
    // Called once at server startup.
    // Initialize your telemetry SDK here (e.g., OpenTelemetry, Sentry).
    console.log('[instrumentation] Server starting...');
  },

  async onRequest(request, context) {
    // Called before each request is processed.
    context.metadata.requestId = crypto.randomUUID();
    console.log(`[instrumentation] ${request.method} ${context.pathname} (${context.routeType})`);
  },

  async onResponseEnd(request, context) {
    // Called after the response is complete.
    console.log(`[instrumentation] ${context.statusCode} ${context.pathname} ${context.duration.toFixed(1)}ms`);
  },

  async onRequestError(error, request, context) {
    // Called when an unhandled error occurs during request processing.
    console.error(`[instrumentation] Error in ${context.pathname}:`, error.message);
  },
});
```

## Available Hooks

| Hook | When it fires | Arguments |
|------|--------------|-----------|
| `register` | Once at server startup | None |
| `onRequest` | Before each request | `(request: Request, context: RequestContext)` |
| `onResponseStart` | When response is ready, before streaming | `(request: Request, response: Response, context: ResponseContext)` |
| `onResponseEnd` | After response stream is complete | `(request: Request, context: ResponseContext)` |
| `onRequestError` | When an unhandled error occurs | `(error: Error, request: Request, context: RequestContext)` |

## Context Objects

- `RequestContext` — includes `routePath`, `pathname`, `routeType` (`'page'` | `'api'` | `'server-action'` | `'not-found'`), `params`, `searchParams`, `startTime`, `startTimeEpoch`, and `metadata`
- `ResponseContext` — extends `RequestContext` with `statusCode` and `duration` (ms)
- `metadata` — a mutable `Record<string, unknown>` shared across all hooks for the same request. Use it to pass data between hooks (e.g., OpenTelemetry spans, request IDs).

## Key Behaviors

- Zero-config: if `app/instrumentation.ts` doesn't exist, the framework silently uses a no-op fallback
- `register()` completes before the first request is handled
- Errors in hooks are caught and logged — they never crash user requests
- Works with page routes, API routes, and server actions
- Compatible with OpenTelemetry, Sentry, Datadog, and any Node.js telemetry SDK

## Built-in request metrics

`createMetricsInstrumentation` provides a ready-made `onResponseEnd` hook that
emits one structured record per completed request — method, route, status,
duration, and (when the framework records them) `renderStrategy` and
`cacheStatus`. Spread it into your instrumentation; it logs through the shared
[Pino logger](./utilities.md#logging) by default, or pass a `sink` to forward
records to your telemetry backend:

```tsx
// app/instrumentation.ts
import { defineInstrumentation } from 'solidstep/utils/instrumentation';
import { createMetricsInstrumentation } from 'solidstep/utils/metrics';

export default defineInstrumentation({
  ...createMetricsInstrumentation({
    // Optional. Defaults to logging each record at `info`.
    sink: (record) => myMetrics.record(record),
  }),
});
```

Error responses still reach `onResponseEnd` with their status code, so failures
are captured too. The framework populates `context.metadata.renderStrategy`
(`'dynamic' | 'isr' | 'ppr' | 'static'`), which appears on each record.

## OpenTelemetry Example

```tsx
// app/instrumentation.ts
import { defineInstrumentation } from 'solidstep/utils/instrumentation';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { trace } from '@opentelemetry/api';

let sdk: NodeSDK;

export default defineInstrumentation({
  async register() {
    sdk = new NodeSDK({
      traceExporter: new OTLPTraceExporter(),
      serviceName: 'my-solidstep-app',
    });
    sdk.start();
  },

  async onRequest(request, context) {
    const tracer = trace.getTracer('solidstep');
    const span = tracer.startSpan(`${request.method} ${context.routePath}`);
    context.metadata.span = span;
  },

  async onResponseEnd(request, context) {
    const span = context.metadata.span as any;
    span?.setAttribute('http.status_code', context.statusCode);
    span?.end();
  },

  async onRequestError(error, request, context) {
    const span = context.metadata.span as any;
    span?.recordException(error);
    span?.end();
  },
});
```

## Related

- [Middleware](./middleware.md) — per-route request interception (distinct from instrumentation).
- [Utilities](./utilities.md#logging) — the built-in Pino logger.
- [Architecture](./architecture.md) — where instrumentation hooks fire in the lifecycle.
