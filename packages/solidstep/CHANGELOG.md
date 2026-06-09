# solidstep

## 0.5.0

### Minor Changes

- 98c27dc: Add two quick-win features and fix a routing bug:

  - **Dynamic metadata files**: `app/robots.ts`, `app/sitemap.ts`, `app/manifest.ts`,
    and `app/llms.ts` convention files now serve `/robots.txt`, `/sitemap.xml`,
    `/manifest.webmanifest`, and `/llms.txt` with the correct `Content-Type`. New
    `solidstep/utils/metadata` export provides `sitemap()` and `robots()` body
    helpers.
  - **Loader caching**: `defineLoader` accepts `options.cache: { ttl, key }` to
    cache a loader's resolved data on the server (keyed per-URL by default).
  - **Fix**: `toPath` stripped the file extension twice using an unescaped-dot
    regex, mangling the route path of any root-level file whose name ends in
    `…ts`/`…js`/`…tsx`/`…jsx` (e.g. `robots.ts` resolved to `/rob`). It now strips
    the extension once.

### Patch Changes

- e7a6bc0: Internal: extract the shared seroval serialization core (chunk framing,
  `serializeToStream`, `SerovalChunkReader`, and the plugin set) into
  `utils/serialize.ts`, de-duplicating it across the server and client
  server-action transports. No public API or behavior change.
