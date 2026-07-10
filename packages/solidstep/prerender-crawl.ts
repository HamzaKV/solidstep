/**
 * Standalone build-time prerender crawler.
 *
 * Invoked (blocking) by the build hook via `spawnSync` — see `index.ts`. It
 * boots the freshly built node server in prerender mode, asks it which routes
 * are `static`/`isr` via the env-gated discovery endpoint, fetches each one
 * (bypassing the ISR cache so it renders fresh), and writes the artifacts:
 * static pages as `.html` into the public dir, ISR pages into the server dir
 * plus a `prerender-manifest.json` the runtime seeds at boot.
 *
 * Run as: `node prerender-crawl.js <serverDir> <publicDir>`. Failures are logged
 * but exit 0 so they never fail the build.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { join, dirname } from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const PRERENDER_ENDPOINT = '/__solidstep_prerender';
const ISR_BYPASS_HEADER = 'x-solidstep-isr-bypass';

type Target = {
    pathname: string;
    render: 'static' | 'isr' | 'ppr';
    revalidate?: number;
    tags?: string[];
};

const [serverDir, publicDir] = process.argv.slice(2);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One ISR seed entry for `prerender-manifest.json`. */
export type IsrSeed = {
    pathname: string;
    revalidate: number;
    tags?: string[];
    file: string;
};

/**
 * Persist one crawled route's artifact: `static`/`ppr` as a public `.html`,
 * `isr` as a server-dir seed + manifest entry. Returns whether anything was
 * written. Exported for unit tests; the crawl loop below drives it.
 */
export const handleCrawledTarget = (
    t: Pick<Target, 'pathname' | 'render' | 'revalidate' | 'tags'>,
    res: { ok: boolean; status: number; html: string },
    dirs: { serverDir: string; publicDir: string },
    isr: IsrSeed[],
): boolean => {
    // Never bake an error response into an artifact: a transient 500 during
    // the crawl would otherwise be served as the page indefinitely. Skipping
    // keeps the crawl non-fatal (per this script's contract) — the route just
    // renders dynamically at runtime until the next build/revalidation.
    if (!res.ok) {
        console.warn(
            `ℹ Prerender skipped ${t.pathname}: server responded ${res.status}.`,
        );
        return false;
    }
    // `static` and `ppr` are both served as .html artifacts from the
    // public dir (a `ppr` artifact is the static shell; its holes are
    // filled on the client).
    if (t.render === 'static' || t.render === 'ppr') {
        const outFile =
            t.pathname === '/'
                ? join(dirs.publicDir, 'index.html')
                : join(dirs.publicDir, t.pathname, 'index.html');
        mkdirSync(dirname(outFile), { recursive: true });
        writeFileSync(outFile, res.html, 'utf-8');
        return true;
    }
    const hash = createHash('sha256').update(t.pathname).digest('hex');
    // Forward-slash relative path so the manifest is portable.
    const file = `prerender/${hash}.html`;
    mkdirSync(join(dirs.serverDir, 'prerender'), { recursive: true });
    writeFileSync(
        join(dirs.serverDir, 'prerender', `${hash}.html`),
        res.html,
        'utf-8',
    );
    isr.push({
        pathname: t.pathname,
        revalidate: t.revalidate ?? 60,
        tags: t.tags,
        file,
    });
    return true;
};

const main = async () => {
    if (!serverDir || !publicDir) return;
    const serverEntry = join(serverDir, 'index.mjs');
    if (!existsSync(serverEntry)) return;

    const port = Number(process.env.SOLIDSTEP_PRERENDER_PORT ?? 41789);
    const host = '127.0.0.1';
    const baseUrl = `http://${host}:${port}`;

    const childEnv: Record<string, string> = {
        ...(process.env as unknown as Record<string, string>),
        PORT: String(port),
        NITRO_PORT: String(port),
        HOST: host,
        SOLIDSTEP_PRERENDER: '1',
    };
    const child: ChildProcess = spawn(process.execPath, [serverEntry], {
        env: childEnv as unknown as NodeJS.ProcessEnv,
        stdio: 'ignore',
    });

    try {
        let targets: Target[] | null = null;
        const deadline = Date.now() + 60_000;
        while (Date.now() < deadline) {
            try {
                const res = await fetch(`${baseUrl}${PRERENDER_ENDPOINT}`);
                if (res.ok) {
                    targets = (await res.json()) as Target[];
                    break;
                }
            } catch {
                // server not up yet
            }
            await sleep(250);
        }

        if (!targets) {
            console.warn(
                'ℹ Prerender skipped: build server did not become ready.',
            );
            return;
        }
        if (targets.length === 0) {
            console.log('ℹ No static/ISR routes to prerender.');
            return;
        }

        const isr: IsrSeed[] = [];
        let staticCount = 0;

        for (const t of targets) {
            const res = await fetch(`${baseUrl}${t.pathname}`, {
                headers: { [ISR_BYPASS_HEADER]: '1' },
            });
            const html = await res.text();
            const written = handleCrawledTarget(
                t,
                { ok: res.ok, status: res.status, html },
                { serverDir, publicDir },
                isr,
            );
            if (written && (t.render === 'static' || t.render === 'ppr')) {
                staticCount += 1;
            }
        }

        writeFileSync(
            join(serverDir, 'prerender-manifest.json'),
            JSON.stringify({ isr }),
            'utf-8',
        );
        console.log(
            `✔ Prerendered ${staticCount} static and ${isr.length} ISR route(s).`,
        );
    } catch (e) {
        console.warn('ℹ Prerender step failed (non-fatal):', e);
    } finally {
        child.kill();
    }
};

// Only run when invoked as a script (`node prerender-crawl.js <dirs>`), not
// when imported (tests import handleCrawledTarget).
if (serverDir && publicDir && existsSync(join(serverDir, 'index.mjs'))) {
    await main();
}
