// Stub for `node:sqlite`.
//
// Nitro's default Node database connector bundles an (unused) `import 'node:sqlite'`
// into the server output. That builtin only exists in Node 22.5+, so on Node 20/21
// the server crashes at startup even though no database is ever used. This app has
// no database, so app.config.ts aliases `node:sqlite` to this empty stub.
export class DatabaseSync {}
export class StatementSync {}
export default { DatabaseSync, StatementSync };
