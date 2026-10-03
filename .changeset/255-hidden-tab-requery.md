---
'@nozzleio/mosaic-core': patch
---

Complete coalesced re-queries in hidden browser tabs. Input-driven triggers (`setInputs`, Param and `havingBy` `'value'` events) ride Mosaic's animation-frame throttle, but browsers pause animation frames while a tab is hidden, so a re-query triggered in a background tab stayed `status: 'pending'` until the tab was shown again. While `document.visibilityState === 'hidden'` the client now coalesces on the same macrotask fallback it already uses outside browsers (one query per tick, last state wins). Visible tabs keep Mosaic's animation-frame throttle unchanged.
