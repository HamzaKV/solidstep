import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as ts from 'typescript';

// Scaffolds a real app via the CLI entrypoint (bin/main.ts) into a temp dir —
// the same thing `npx create-solidstep <name>` does — and asserts on the
// result, mirroring the manual scaffold smoke test previously done by hand.
// This package had zero automated tests before this file.

let appDir: string;
let parentDir: string;

beforeAll(() => {
    parentDir = mkdtempSync(join(tmpdir(), 'create-solidstep-test-'));
    execFileSync(
        process.platform === 'win32' ? 'npx.cmd' : 'npx',
        ['tsx', join(import.meta.dirname, '../bin/main.ts'), 'app'],
        { cwd: parentDir, shell: process.platform === 'win32' },
    );
    appDir = join(parentDir, 'app');
});

afterAll(() => {
    rmSync(parentDir, { recursive: true, force: true });
});

describe('create-solidstep scaffold', () => {
    it('creates the app directory with the expected files', () => {
        for (const file of [
            'package.json',
            'app.config.ts',
            'tsconfig.json',
            '.gitignore',
            '.env.example',
            'AGENTS.md',
            'app/page.tsx',
            'app/layout.tsx',
            'app/middleware.ts',
            'app/instrumentation.ts',
        ]) {
            expect(existsSync(join(appDir, file)), file).toBe(true);
        }
    });

    it('generates a package.json with the expected dependencies', () => {
        const pkg = JSON.parse(
            readFileSync(join(appDir, 'package.json'), 'utf-8'),
        );
        expect(pkg.dependencies).toMatchObject({
            'solid-js': expect.any(String),
            solidstep: expect.any(String),
            vinxi: expect.any(String),
        });
    });

    it('generates a syntactically valid app/middleware.ts', () => {
        const source = readFileSync(join(appDir, 'app/middleware.ts'), 'utf-8');
        const { diagnostics } = ts.transpileModule(source, {
            compilerOptions: {
                module: ts.ModuleKind.ESNext,
                jsx: ts.JsxEmit.Preserve,
            },
            reportDiagnostics: true,
        });
        expect(diagnostics ?? []).toEqual([]);
    });

    describe('scaffolded middleware security defaults', () => {
        // Regression coverage for the template's actual security posture, not
        // just its existence -- so deleting/weakening a default silently in
        // the template fails CI instead of only showing up when a real app
        // ships without protection.
        let source: string;
        beforeAll(() => {
            source = readFileSync(join(appDir, 'app/middleware.ts'), 'utf-8');
        });

        it('wires bodyLimit with a sane (non-zero, non-Infinity) maxBytes', () => {
            const match = source.match(
                /bodyLimit\(\s*\{\s*maxBytes:\s*([\d_]+)/,
            );
            expect(match).not.toBeNull();
            const maxBytes = Number(match![1].replace(/_/g, ''));
            expect(maxBytes).toBeGreaterThan(0);
            expect(Number.isFinite(maxBytes)).toBe(true);
        });

        it('wires rateLimit with sane (non-zero, non-Infinity) windowMs and max', () => {
            const match = source.match(
                /rateLimit\(\s*\{\s*windowMs:\s*([\d_]+),\s*max:\s*([\d_]+)/,
            );
            expect(match).not.toBeNull();
            const windowMs = Number(match![1].replace(/_/g, ''));
            const max = Number(match![2].replace(/_/g, ''));
            expect(windowMs).toBeGreaterThan(0);
            expect(max).toBeGreaterThan(0);
            expect(Number.isFinite(windowMs)).toBe(true);
            expect(Number.isFinite(max)).toBe(true);
        });

        it('seeds a non-empty default trustedOrigins list for cors/csrf', () => {
            const match = source.match(
                /const trustedOrigins[^;]*\[\s*([^\]]*)\]/s,
            );
            expect(match).not.toBeNull();
            const entries = match![1]
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
            expect(entries.length).toBeGreaterThan(0);
            expect(source).toMatch(/cors\(trustedOrigins\)/);
            expect(source).toMatch(/csrf\(trustedOrigins\)/);
        });

        it('generates a per-request CSP nonce and wires it into the policy', () => {
            expect(source).toMatch(/randomBytes\(\d+\)/);
            expect(source).toMatch(/withNonce\(policy,\s*nonce\)/);
            expect(source).toMatch(/Content-Security-Policy/);
        });
    });
});

describe('shouldIncludeInScaffold', () => {
    it('excludes node_modules and .git at the template root', async () => {
        const { shouldIncludeInScaffold } = await import(
            '../bin/scaffold-filter'
        );
        const templateDir = '/tpl';
        expect(shouldIncludeInScaffold(templateDir, '/tpl/node_modules')).toBe(
            false,
        );
        expect(
            shouldIncludeInScaffold(templateDir, '/tpl/node_modules/x/y.js'),
        ).toBe(false);
        expect(shouldIncludeInScaffold(templateDir, '/tpl/.git')).toBe(false);
        expect(shouldIncludeInScaffold(templateDir, '/tpl/.git/HEAD')).toBe(
            false,
        );
    });

    it('includes ordinary template files', async () => {
        const { shouldIncludeInScaffold } = await import(
            '../bin/scaffold-filter'
        );
        const templateDir = '/tpl';
        expect(shouldIncludeInScaffold(templateDir, '/tpl/package.json')).toBe(
            true,
        );
        expect(shouldIncludeInScaffold(templateDir, '/tpl/app/page.tsx')).toBe(
            true,
        );
    });
});
