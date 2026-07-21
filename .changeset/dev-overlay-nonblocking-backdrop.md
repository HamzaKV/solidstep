---
'solidstep': patch
---

The dev error overlay's full-viewport backdrop no longer blocks pointer events on the page underneath it -- only the Dismiss button stays clickable (`pointer-events:none` on `.ss-devoverlay`, `pointer-events:auto` on `.ss-close`). Previously an unhandled SSR/client error would trap all mouse interaction behind a modal overlay until explicitly dismissed.
