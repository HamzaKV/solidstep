import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleCrawledTarget } from '../prerender-crawl';

let serverDir: string;
let publicDir: string;

beforeEach(() => {
    serverDir = mkdtempSync(join(tmpdir(), 'ss-crawl-server-'));
    publicDir = mkdtempSync(join(tmpdir(), 'ss-crawl-public-'));
});

afterEach(() => {
    rmSync(serverDir, { recursive: true, force: true });
    rmSync(publicDir, { recursive: true, force: true });
});

describe('handleCrawledTarget', () => {
    it('writes a static artifact for a 200 response', () => {
        const isr: unknown[] = [];
        const written = handleCrawledTarget(
            { pathname: '/about', render: 'static' },
            { ok: true, status: 200, html: '<html>about</html>' },
            { serverDir, publicDir },
            isr as never,
        );
        expect(written).toBe(true);
        const artifact = join(publicDir, 'about', 'index.html');
        expect(existsSync(artifact)).toBe(true);
        expect(readFileSync(artifact, 'utf-8')).toBe('<html>about</html>');
    });

    it('seeds an ISR entry for a 200 response', () => {
        const isr: { pathname: string; file: string }[] = [];
        const written = handleCrawledTarget(
            { pathname: '/isr-page', render: 'isr', revalidate: 30 },
            { ok: true, status: 200, html: '<html>isr</html>' },
            { serverDir, publicDir },
            isr as never,
        );
        expect(written).toBe(true);
        expect(isr).toHaveLength(1);
        expect(existsSync(join(serverDir, isr[0].file))).toBe(true);
    });

    it('does NOT bake an error response into a static artifact', () => {
        const isr: unknown[] = [];
        const written = handleCrawledTarget(
            { pathname: '/broken', render: 'static' },
            { ok: false, status: 500, html: '<html>Internal Error</html>' },
            { serverDir, publicDir },
            isr as never,
        );
        // Skipped: the route falls back to dynamic rendering at runtime
        // instead of serving a poisoned artifact forever.
        expect(written).toBe(false);
        expect(existsSync(join(publicDir, 'broken', 'index.html'))).toBe(false);
    });

    it('does NOT seed an ISR entry from an error response', () => {
        const isr: unknown[] = [];
        const written = handleCrawledTarget(
            { pathname: '/broken-isr', render: 'isr' },
            { ok: false, status: 503, html: 'Service Unavailable' },
            { serverDir, publicDir },
            isr as never,
        );
        expect(written).toBe(false);
        expect(isr).toHaveLength(0);
    });
});
