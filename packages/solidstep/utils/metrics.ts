// utils/metrics.ts
// Opt-in default request metrics, emitted through the existing instrumentation
// hooks. Spread the returned hooks into your `app/instrumentation.ts` to get one
// structured record per completed request (timing, status, route, and — when the
// framework populates them — cache status and render strategy) without wiring a
// telemetry backend by hand. Point `sink` at OpenTelemetry/StatsD/etc. to export.

import { logger } from './logger';
import type {
    OnResponseEndFn,
    RequestContext,
    ResponseContext,
} from './instrumentation';

/** One completed-request metric record. */
export type MetricRecord = {
    method: string;
    /** The matched route pattern (e.g. "/posts/[id]"). */
    routePath: string;
    routeType: RequestContext['routeType'];
    statusCode: number;
    /** Wall-clock duration in whole milliseconds. */
    durationMs: number;
    /** Populated when the framework recorded a cache hit/miss for the request. */
    cacheStatus?: string;
    /** The render strategy used: 'dynamic' | 'isr' | 'ppr' | 'static' | etc. */
    renderStrategy?: string;
};

/** Options for {@link createMetricsInstrumentation}. */
export type MetricsOptions = {
    /**
     * Receives each completed-request record. Defaults to logging it at `info`
     * via the shared logger (so it's silent unless logging is enabled).
     */
    sink?: (record: MetricRecord) => void;
};

/** Project a request + its response context into a {@link MetricRecord}. */
export const buildMetricRecord = (
    request: Request,
    context: ResponseContext,
): MetricRecord => ({
    method: request.method,
    routePath: context.routePath,
    routeType: context.routeType,
    statusCode: context.statusCode,
    durationMs: Math.round(context.duration),
    cacheStatus:
        typeof context.metadata.cacheStatus === 'string'
            ? context.metadata.cacheStatus
            : undefined,
    renderStrategy:
        typeof context.metadata.renderStrategy === 'string'
            ? context.metadata.renderStrategy
            : undefined,
});

/**
 * Build an instrumentation fragment that emits a {@link MetricRecord} on every
 * completed request (including error responses, which still reach
 * `onResponseEnd` with their status code).
 *
 * @example
 * ```ts
 * // app/instrumentation.ts
 * import { defineInstrumentation } from 'solidstep/utils/instrumentation';
 * import { createMetricsInstrumentation } from 'solidstep/utils/metrics';
 *
 * export default defineInstrumentation({
 *   ...createMetricsInstrumentation(),
 * });
 * ```
 */
export const createMetricsInstrumentation = (
    options: MetricsOptions = {},
): { onResponseEnd: OnResponseEndFn } => {
    const sink =
        options.sink ??
        ((record: MetricRecord) => logger.info(record, 'request'));
    return {
        onResponseEnd: (request, context) => {
            sink(buildMetricRecord(request, context));
        },
    };
};
