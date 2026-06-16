import { describe, it, expect, vi } from 'vitest';
import {
    buildMetricRecord,
    createMetricsInstrumentation,
} from '../utils/metrics';
import type { ResponseContext } from '../utils/instrumentation';

const ctx = (over: Partial<ResponseContext> = {}): ResponseContext => ({
    routePath: '/posts/[id]',
    pathname: '/posts/1',
    routeType: 'page',
    params: {},
    searchParams: {},
    startTime: 0,
    metadata: {},
    startTimeEpoch: 0,
    statusCode: 200,
    duration: 12.7,
    ...over,
});

describe('buildMetricRecord', () => {
    it('projects request + context into a record and rounds the duration', () => {
        const rec = buildMetricRecord(
            new Request('https://example.com/posts/1'),
            ctx(),
        );
        expect(rec).toMatchObject({
            method: 'GET',
            routePath: '/posts/[id]',
            routeType: 'page',
            statusCode: 200,
            durationMs: 13,
        });
        expect(rec.cacheStatus).toBeUndefined();
        expect(rec.renderStrategy).toBeUndefined();
    });

    it('includes cacheStatus and renderStrategy when present as strings', () => {
        const rec = buildMetricRecord(
            new Request('https://example.com/'),
            ctx({ metadata: { cacheStatus: 'hit', renderStrategy: 'isr' } }),
        );
        expect(rec.cacheStatus).toBe('hit');
        expect(rec.renderStrategy).toBe('isr');
    });
});

describe('createMetricsInstrumentation', () => {
    it('emits a record to a custom sink on response end (incl. errors)', async () => {
        const sink = vi.fn();
        const inst = createMetricsInstrumentation({ sink });
        await inst.onResponseEnd(
            new Request('https://example.com/'),
            ctx({ statusCode: 500 }),
        );
        expect(sink).toHaveBeenCalledTimes(1);
        expect(sink.mock.calls[0][0].statusCode).toBe(500);
    });

    it('defaults to logging through the shared logger when no sink is given', () => {
        const inst = createMetricsInstrumentation();
        expect(
            inst.onResponseEnd(new Request('https://example.com/'), ctx()),
        ).toBeUndefined();
    });
});
