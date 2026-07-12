---
'@nozzleio/mosaic-core': patch
---

Coalesce input-driven re-queries. `setInputs`, Param `'value'`, and `havingBy` `'value'` no longer issue an immediate `requestQuery()` per event: a burst of synchronous changes in one tick — page-spam, a dragged slider Param — collapses into a single query build with the last state winning. In browsers this rides upstream `MosaicClient.requestUpdate()` (animation-frame throttle); in environments without `requestAnimationFrame` the client uses a built-in macrotask fallback with the same one-build-per-tick semantics. `status` still flips to `'pending'` synchronously so loading indicators stay responsive, and `refetch()` remains immediate and un-coalesced (it also cancels a pending fallback flush). No API surface change; only re-query timing.
