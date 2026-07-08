---
'solidstep': minor
---

Add View Transitions API integration to the client router. `<Link viewTransition>` and `navigate(to, { viewTransition: true })` wrap the navigation commit in `document.startViewTransition()` when the browser supports it and the user hasn't requested reduced motion; otherwise the commit runs directly, unchanged from today.

Each history entry records whether arriving at it was a view transition, so a later back/forward landing on that entry replays the same transition it originally arrived with.
