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

        const isr: {
            pathname: string;
            revalidate: number;
            tags?: string[];
            file: string;
        }[] = [];
        let staticCount = 0;

        for (const t of targets) {
            const res = await fetch(`${baseUrl}${t.pathname}`, {
                headers: { [ISR_BYPASS_HEADER]: '1' },
            });
            const html = await res.text();

            // `static` and `ppr` are both served as .html artifacts from the
            // public dir (a `ppr` artifact is the static shell; its holes are
            // filled on the client).
            if (t.render === 'static' || t.render === 'ppr') {
                const outFile =
                    t.pathname === '/'
                        ? join(publicDir, 'index.html')
                        : join(publicDir, t.pathname, 'index.html');
                mkdirSync(dirname(outFile), { recursive: true });
                writeFileSync(outFile, html, 'utf-8');
                staticCount += 1;
            } else {
                const hash = createHash('sha256')
                    .update(t.pathname)
                    .digest('hex');
                // Forward-slash relative path so the manifest is portable.
                const file = `prerender/${hash}.html`;
                mkdirSync(join(serverDir, 'prerender'), { recursive: true });
                writeFileSync(
                    join(serverDir, 'prerender', `${hash}.html`),
                    html,
                    'utf-8',
                );
                isr.push({
                    pathname: t.pathname,
                    revalidate: t.revalidate ?? 60,
                    tags: t.tags,
                    file,
                });
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

await main();
