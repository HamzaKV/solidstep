#!/usr/bin/env node
// Zero-dependency HTTP benchmark for relative before/after comparisons on one
// machine. Not a substitute for autocannon-grade absolute numbers, but stable
// enough to prove/disprove a perf change without adding a devDependency.
//
// Usage: BASE_URL=http://localhost:3210 node scripts/bench.mjs
// Prereq: build + start a production server (see docs/performance.md).

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3210';
const DURATION_MS = Number(process.env.DURATION_MS ?? 10_000);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 20);
const WARMUP_REQUESTS = Number(process.env.WARMUP ?? 200);

const ROUTES = [
    '/',
    '/about',
    '/slow',
    '/deferred',
    '/isr',
    '/ppr',
    '/__solidstep_route?url=%2F',
];

const percentile = (sorted, p) => {
    if (sorted.length === 0) return 0;
    const idx = Math.min(
        sorted.length - 1,
        Math.floor((p / 100) * sorted.length),
    );
    return sorted[idx];
};

const drain = async (res) => {
    const reader = res.body?.getReader();
    if (!reader) return;
    for (;;) {
        const { done } = await reader.read();
        if (done) break;
    }
};

const timedRequest = async (url) => {
    const start = performance.now();
    let ttfb = null;
    let error = null;
    try {
        const res = await fetch(url);
        const reader = res.body?.getReader();
        if (reader) {
            const { done, value } = await reader.read();
            ttfb = performance.now() - start;
            if (!done && value) {
                for (;;) {
                    const next = await reader.read();
                    if (next.done) break;
                }
            }
        } else {
            await drain(res);
            ttfb = performance.now() - start;
        }
        if (!res.ok) error = `status ${res.status}`;
    } catch (err) {
        error = err instanceof Error ? err.message : String(err);
    }
    const total = performance.now() - start;
    return { total, ttfb: ttfb ?? total, error };
};

const warmup = async (url) => {
    const workers = Array.from(
        { length: Math.min(CONCURRENCY, 10) },
        async () => {
            let done = 0;
            const perWorker = Math.ceil(
                WARMUP_REQUESTS / Math.min(CONCURRENCY, 10),
            );
            while (done < perWorker) {
                await timedRequest(url);
                done += 1;
            }
        },
    );
    await Promise.all(workers);
};

const runLoad = async (url) => {
    const results = [];
    const deadline = performance.now() + DURATION_MS;
    const workers = Array.from({ length: CONCURRENCY }, async () => {
        while (performance.now() < deadline) {
            results.push(await timedRequest(url));
        }
    });
    await Promise.all(workers);
    return results;
};

const benchRoute = async (route) => {
    const url = `${BASE_URL}${route}`;
    await warmup(url);
    const results = await runLoad(url);

    const errors = results.filter((r) => r.error);
    const ok = results.filter((r) => !r.error);
    const totals = ok.map((r) => r.total).sort((a, b) => a - b);
    const ttfbs = ok.map((r) => r.ttfb).sort((a, b) => a - b);
    const seconds = DURATION_MS / 1000;

    return {
        route,
        requests: results.length,
        errors: errors.length,
        rps: Math.round(ok.length / seconds),
        latencyP50: Math.round(percentile(totals, 50)),
        latencyP95: Math.round(percentile(totals, 95)),
        latencyP99: Math.round(percentile(totals, 99)),
        ttfbP50: Math.round(percentile(ttfbs, 50)),
        ttfbP99: Math.round(percentile(ttfbs, 99)),
    };
};

const printTable = (rows) => {
    const cols = [
        ['route', 'route'],
        ['requests', 'reqs'],
        ['errors', 'errs'],
        ['rps', 'rps'],
        ['latencyP50', 'p50ms'],
        ['latencyP95', 'p95ms'],
        ['latencyP99', 'p99ms'],
        ['ttfbP50', 'ttfb50'],
        ['ttfbP99', 'ttfb99'],
    ];
    const widths = cols.map(([key, label]) =>
        Math.max(label.length, ...rows.map((r) => String(r[key]).length)),
    );
    const line = (values) =>
        values.map((v, i) => String(v).padEnd(widths[i])).join('  ');
    console.log(line(cols.map(([, label]) => label)));
    console.log(widths.map((w) => '-'.repeat(w)).join('  '));
    for (const row of rows) {
        console.log(line(cols.map(([key]) => row[key])));
    }
};

const main = async () => {
    console.log(
        `Benchmarking ${BASE_URL} — ${CONCURRENCY} concurrent, ${DURATION_MS}ms/route\n`,
    );
    const rows = [];
    for (const route of ROUTES) {
        const row = await benchRoute(route);
        rows.push(row);
    }
    printTable(rows);
    console.log(`\n${JSON.stringify({ baseUrl: BASE_URL, rows })}`);
};

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
