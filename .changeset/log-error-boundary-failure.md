---
'solidstep': patch
---

Fix: if a page's own `error.tsx` threw while rendering the fallback for an
earlier render failure, the secondary error was silently discarded — only
the original error propagated, with no trace of why the error boundary
itself never rendered. That secondary failure is now logged via the
framework logger before the original error is re-thrown.
