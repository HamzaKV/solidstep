---
'solidstep': patch
---

Fix `singleFlight` throwing synchronously instead of returning a rejected
promise when `fn` throws synchronously (a non-`async` function). It's typed
and documented to always return a `Promise<T>`; every current caller passes
an `async` function so this wasn't reachable in practice, but it's now
correct for any `fn`.
