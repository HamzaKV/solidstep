---
'solidstep': major
---

Raise the minimum supported Node.js version to `>=22.19.0`. The framework's direct `undici@^8.7.0` dependency itself requires Node `>=22.19.0` and unconditionally calls a `node:worker_threads` API absent on earlier Node versions — so any solidstep app running on Node 20 or 21 was crashing immediately at server startup, despite `engines.node` previously (incorrectly) claiming `>=20` support. This change makes the declared requirement match reality instead of downgrading `undici`.
