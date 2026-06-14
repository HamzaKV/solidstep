// Type-only check (not a route — `_`-prefixed files are non-routable). Proves
// the generated `solidstep-env.d.ts` types `Href`. Requires a build first
// (the typegen plugin writes the route types during `vinxi build`/`dev`).
import type { Href } from 'solidstep/router';

// A real route → accepted.
const ok: Href = '/about';
// A typo'd route → rejected by the generated union.
// @ts-expect-error '/nope' is not a route in this app.
const bad: Href = '/nope';

void ok;
void bad;
