import { defineConfig } from 'solidstep';
import { fileURLToPath } from 'node:url';

// Nitro's default Node database connector bundles an unused `import 'node:sqlite'`,
// a builtin that only exists in Node 22.5+. This starter uses no database, so we both
// pass an empty `database` config and alias the builtin to an empty stub, keeping the
// production server runnable on Node 20/21.
const sqliteStub = fileURLToPath(new URL('./sqlite-stub.mjs', import.meta.url));

export default defineConfig({
    server: {
        preset: 'node-server',
        database: {},
        alias: {
            'node:sqlite': sqliteStub,
        },
    },
});
