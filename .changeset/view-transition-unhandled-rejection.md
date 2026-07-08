---
'solidstep': patch
---

A view-transition navigation whose commit callback throws (e.g. a bad `applyMeta`/route-state update) no longer produces an unhandled promise rejection — `withViewTransition` now catches the transition's `updateCallbackDone` and logs the error to the console instead.
