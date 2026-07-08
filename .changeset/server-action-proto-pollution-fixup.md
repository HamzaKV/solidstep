---
'solidstep': patch
---

Fix a regression from the previous `Object.hasOwn` guard against prototype-chain `functionId` values (`__proto__`, `constructor`, etc.): the real server-functions manifest's `chunks` is a lazily-resolving object whose entries aren't visible to `Object.keys`/`Object.hasOwn` (only direct indexing resolves them), so the guard rejected every legitimate `functionId`, breaking all server actions. Replaced with a shape check on the resolved value instead (`typeof chunkEntry.import !== 'function'`) — a real chunk always has a callable `.import`, while a prototype-chain property never does, so this closes the same gap without depending on how `chunks`'s own-property list is implemented.
