---
'solidstep': patch
---

Fix: the top-level request handler and `revalidatePath` matched server-action
requests with `url.includes('_server')` / `path.includes('_server')` — a
substring check. An ordinary page route whose path happened to contain
`_server` (e.g. `/page_server`) was misrouted into the server-function
dispatcher, and `revalidatePath` could be called from such a page without
throwing its "server functions only" guard. Both now match the real
`@vinxi/server-functions` mount point exactly: the pathname must equal
`/_server` or start with `/_server/`.
