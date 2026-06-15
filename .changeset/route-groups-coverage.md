---
"solidstep": patch
---

Organizational route groups (`(group)` folders that don't affect the URL) are now
covered end-to-end. The feature already worked — the server manifest, client
manifest, and typed-routes generation all strip `(group)` segments — but it was
only lightly tested. Added a client-manifest unit test proving a `(group)`
segment is stripped from the URL while a `layout.tsx` inside the group still wraps
the route, plus a kitchen-sink `(marketing)` example with an e2e test, and
expanded the routing docs to note that grouped layouts/boundaries apply.
