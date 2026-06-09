# Metadata Files

[← Back to docs index](./README.md)

SolidStep serves a small set of conventional metadata files from the **app root**. Create the file, export a default function returning the body, and the framework serves it at the conventional URL with the correct `Content-Type`. The function receives the `Request` and may be `async`.

| File (app root) | Served at | Content-Type |
|---|---|---|
| `robots.{ts,js}` | `/robots.txt` | `text/plain` |
| `sitemap.{ts,js}` | `/sitemap.xml` | `application/xml` |
| `manifest.{ts,js}` | `/manifest.webmanifest` | `application/manifest+json` |
| `llms.{ts,js}` | `/llms.txt` | `text/plain` |

A string return is sent as-is; an object return (e.g. for `manifest`) is serialized as JSON.

> If a matching static file exists in `public/` (e.g. `public/robots.txt`), the static router serves it first and the dynamic file is ignored.

## robots.txt

The `robots()` helper from `solidstep/utils/metadata` builds the body:

```ts
// app/robots.ts
import { robots } from 'solidstep/utils/metadata';

export default () =>
  robots({
    rules: { userAgent: '*', allow: '/', disallow: '/admin' },
    sitemap: 'https://example.com/sitemap.xml',
  });
```

`rules` accepts a single rule or an array. Each rule may set `userAgent` (single or array; defaults to `*`), `allow`, `disallow` (single or array), and `crawlDelay`. Top-level `sitemap` (single or array) and `host` are appended.

## sitemap.xml

The `sitemap()` helper builds the XML from an array of entries:

```ts
// app/sitemap.ts
import { sitemap } from 'solidstep/utils/metadata';

export default () =>
  sitemap([
    { url: 'https://example.com/', changeFrequency: 'daily', priority: 1 },
    { url: 'https://example.com/about', lastModified: new Date() },
  ]);
```

Each entry requires `url`; `lastModified` (a `Date` is serialized to ISO 8601), `changeFrequency`, and `priority` are optional. URLs are XML-escaped. Because the file is just a function, you can fetch your routes/content first and map them to entries.

## manifest.webmanifest

Return a plain object — no helper needed:

```ts
// app/manifest.ts
export default () => ({
  name: 'My App',
  short_name: 'App',
  start_url: '/',
  display: 'standalone',
});
```

## llms.txt

Return a string:

```ts
// app/llms.ts
export default () => `# My App\n\nWhat this site is about, for LLMs.\n`;
```

## Related

- [Metadata](./metadata.md) — per-page `<head>` tags via `generateMeta`.
- [Routing](./routing.md) — file conventions and special files.
