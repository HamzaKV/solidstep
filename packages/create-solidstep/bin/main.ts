#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { sep, join } from 'node:path';
import { mkdir, cp } from 'node:fs/promises';
import packageJson from '../package.json' with { type: 'json' };

const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
        help: {
            type: 'boolean',
            short: 'h',
            description: 'Display help information'
        },
        version: {
            type: 'boolean',
            short: 'v',
            description: 'Display version information'
        }
    },
    strict: true,
    allowPositionals: true,
});

const main = async () => {
    if (values.help) {
        console.log('Usage: create-solidstep [options] [app-name]');
        console.log('Options:');
        console.log('  -h, --help     Display help information');
        console.log('  -v, --version  Display version information');
        return;
    }

    if (values.version) {
        console.log(`create-solidstep version ${packageJson.version}`);
        return;
    }

    try {
        let createAppDir = true;
        // get the current name of the app or extract from the current directory
        let appName = positionals[0];

        if (!appName) {
            appName = process.cwd().split(sep).pop() as string;
            createAppDir = false;
        }

        if (createAppDir) {
            await mkdir(appName, { recursive: true });
        }

        const templateDir = join(import.meta.dirname, '../generate');
        const targetDir = createAppDir ? join(process.cwd(), appName) : process.cwd();

        await cp(templateDir, targetDir, {
            recursive: true,
            filter: (src) => {
                // Exclude node_modules and .git directories
                const relativePath = src.replace(templateDir, '');
                return !relativePath.startsWith('node_modules') && !relativePath.startsWith('.git');
            }
        });

        console.log(`SolidStep app created successfully in ${targetDir}`);
        console.log('Install dependencies using a package manager of your choice (npm, yarn, pnpm, etc.) and run the app using the "dev" or "start" script.');

        process.exit(0);
    } catch (error) {
        console.error('An error occurred:', error);
        process.exit(1);
    }
};

main();
