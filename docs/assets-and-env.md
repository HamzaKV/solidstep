# Assets & Environment

[← Back to docs index](./README.md)

## Fonts

Install fonts (for example, from [Fontsource](https://github.com/fontsource/fontsource)) and import into `globals.css` example:
```css
@import '@fontsource-variable/dm-sans';
@import '@fontsource-variable/jetbrains-mono';

@theme inline {
  --font-sans: 'DM Sans Variable', sans-serif; 
  --font-mono: 'JetBrains Mono Variable', monospace; 
  /* ... */
}
```

You can also load fonts via [metadata](./metadata.md) `<link>` tags (e.g. Google Fonts).

## Images

Use the package called [Unpic](https://unpic.pics/img/solid/) for images. An open source and powerful tool for images on the web.
```bash
[npm | yarn | pnpm | bun] install @unpic/solid
```

```tsx
import type { Component } from "solid-js";
import { Image } from "@unpic/solid";

const MyComponent: Component = () => {
  return (
    <Image
      src="https://cdn.shopify.com/static/sample-images/bath_grande_crop_center.jpeg"
      layout="constrained"
      width={800}
      height={600}
      alt="A lovely bath"
    />
  );
};
```

## Environment Variables

As SolidStep is built using Vite, it follows the same guide as stated in [Vite docs](https://vite.dev/guide/env-and-mode) regarding environment variables. Variables placed in `.env` files are loaded by Vite, and only variables prefixed with `VITE_` are exposed to client-side code. Keep secrets unprefixed so they remain server-only — see [Security](./security.md#server-only-code).

See [Deployment](./deployment.md#environment-variables) for environment variables in production builds.

## Related

- [Metadata](./metadata.md) — preconnect and stylesheet links for fonts.
- [Security](./security.md) — keeping secrets out of client bundles.
