// Stub for `node:sqlite`.
//
// Nitro's default Node database connector bundles an (unused) `import 'node:sqlite'`
// into the server output regardless of whether a database is configured. This app
// has no database, so app.config.ts aliases `node:sqlite` to this empty stub rather
// than depending on the host Node build having that (still-experimental) builtin.
export class DatabaseSync {}
export class StatementSync {}
export default { DatabaseSync, StatementSync };
