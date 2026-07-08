---
'solidstep': patch
---

Fix `isSafeRedirectTarget` (and therefore `safeRedirect`) accepting a protocol-relative open-redirect target when a control character (tab, CR, or LF) is inserted between the leading slashes, e.g. `"/\t/evil.com"`. The WHATWG URL parser strips these characters before resolving a URL, so the browser treats the target as `https://evil.com/` even though it doesn't literally start with `//`. Any ASCII control character in the target is now rejected outright.
