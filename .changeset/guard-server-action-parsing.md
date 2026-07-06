---
'solidstep': patch
---

Fix: `handleServerFunction` resolved the target chunk and parsed the request's
arguments (query-string JSON for bound args, `formData()`/`.json()` for a POST
body) before the `try` block that runs the action and maps its errors. An
unknown `functionId` or malformed input therefore threw unhandled, skipping
the `onRequestError`/`onResponseEnd` instrumentation hooks entirely. Both now
map to a proper response instead: an unresolvable server-function chunk
returns 404, and malformed args/form-data/JSON input returns 400 — both still
firing the instrumentation hooks like any other request.
