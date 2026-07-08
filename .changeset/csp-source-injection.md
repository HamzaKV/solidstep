---
'solidstep': patch
---

`createDirective`, `addSource`, and `setSources` (`solidstep/utils/csp`) now throw if a source value contains a `;`, `\r`, or `\n`. Previously an adversarial or misconfigured source (e.g. a `CDN_URL` env var threaded through `withCDN`) would be joined verbatim into the serialized policy header, letting an embedded `;` smuggle a whole new directive (e.g. turning `script-src https://cdn.example.com; script-src *` into two directives, the second unrestricted) and silently defeat the policy. Real CSP sources (keywords, hashes, nonces, schemes, hostnames) never legitimately need these characters.

**Breaking:** a source value that previously passed through silently now throws at policy-construction time.
