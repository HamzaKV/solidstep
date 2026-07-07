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
});
