// Header a self-fetch sets so the handler renders an ISR page fresh instead of
// serving (or recursing into) the ISR cache. Also set by the build-time crawler.
export const ISR_BYPASS_HEADER = 'x-solidstep-isr-bypass';
// Internal, env-gated endpoint the build crawler hits to learn what to prerender.
export const PRERENDER_ENDPOINT = '/__solidstep_prerender';
// Internal endpoint the client calls to fill a PPR page's dynamic holes: it runs
// a deferred loader (identified by its manifest path, validated against the
// matched route) and returns its data as JSON.
export const LOADER_ENDPOINT = '/__solidstep_loader';
// Internal endpoint the client router calls on a soft navigation: it resolves
// ALL of a route's loader data + metadata in one round-trip and returns a
// seroval-serialized envelope the client deserializes (so Date/Map/etc. survive).
export const ROUTE_ENDPOINT = '/__solidstep_route';
// Base path @vinxi/server-functions mounts server actions under. Requests hit
// this path exactly (optionally with a trailing slash), never as a segment
// nested under another route — match it precisely, not as a substring, so an
// ordinary page path (e.g. `/page_server`) is never misrouted as an action.
export const SERVER_FN_BASE = '/_server';
// Internal, env-gated endpoint (`SOLIDSTEP_REVALIDATE_TOKEN`) a CMS webhook or
// deploy hook POSTs to, to invalidate a page's cache (`{ path }`) or every
// entry tagged with a cache tag (`{ tag }`) without a redeploy.
export const REVALIDATE_ENDPOINT = '/__solidstep_revalidate';
