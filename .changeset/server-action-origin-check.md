---
'solidstep': minor
---

Feat/Breaking: server functions (`/_server`) now reject cross-origin requests
with a 403 by default.

The check inspects `Sec-Fetch-Site`/`Origin`: a request from another origin
that isn't in `security.serverActions.trustedOrigins` is blocked before the
action runs. A request with neither header (non-browser clients — curl,
mobile apps, server-to-server calls) is unaffected, since a browser sending
a cross-origin request always sends at least one of them.

Configure via `defineConfig`:

```ts
export default defineConfig({
    security: {
        serverActions: {
            trustedOrigins: ['partner.example.com'],
            // originCheck: false, // to disable entirely
        },
    },
});
```

If you have a legitimate cross-origin caller of your server functions (a
mobile app using a browser webview, another site embedding a form), add its
host to `trustedOrigins` or set `originCheck: false`.
