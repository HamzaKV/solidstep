---
"solidstep": patch
---

Internal: extract the shared seroval serialization core (chunk framing,
`serializeToStream`, `SerovalChunkReader`, and the plugin set) into
`utils/serialize.ts`, de-duplicating it across the server and client
server-action transports. No public API or behavior change.
