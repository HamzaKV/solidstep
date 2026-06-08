# Metadata

[← Back to docs index](./README.md)

Define metadata for SEO. Export a `generateMeta` from a `page.tsx` or `layout.tsx`, wrapping your function with `meta()`. The function may be synchronous or `async` and receives `{ req, cspNonce }`.

```tsx
import { meta } from 'solidstep/utils/meta';

// can also be async
export const generateMeta = meta(() => {
  return {
    title: {
      type: 'title',
      content: 'My Site',
      attributes: {},
    },
    description: {
      type: 'meta',
      attributes: {
        name: 'description',
        content: 'My awesome site',
      },
    },
    // manifest
    manifest: {
      type: 'link',
      attributes: {
        rel: 'manifest',
        href: '/site.webmanifest',
      },
    },
    // google fonts
    'google-font-link': {
        type: 'link',
        attributes: {
            rel: 'preconnect',
            href: 'https://fonts.googleapis.com'
        }
    },
    'gstatic-font-link': {
        type: 'link',
        attributes: {
            rel: 'preconnect',
            href: 'https://fonts.gstatic.com',
            crossorigin: ''
        }
    },
    'inter-font': {
        type: 'link',
        attributes: {
            rel: 'stylesheet',
            href: 'https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap'
        }
    },
    // external js
    'analytics-script': {
        type: 'script',
        attributes: {
            src: 'analytics.js',
            defer: true,
        }
    }
  };
});
```

Each entry is keyed by a unique name and has a `type` of `'title' | 'meta' | 'link' | 'style' | 'script'`. `attributes` are rendered as HTML attributes on the tag; `content` is used for the inner text of a `<title>`. Metadata from layouts and the page are merged (page entries override layout entries with the same key).

> **Note:** The package export is `solidstep/utils/meta`.

## Related

- [Routing](./routing.md) — metadata is defined per page/layout.
- [Assets & Environment](./assets-and-env.md) — fonts and images.
- [Security](./security.md) — `cspNonce` is available on the meta function parameters for CSP.
