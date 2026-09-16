---
'@nozzleio/mosaic-core': patch
---

`skipSources` now applies in front of the coordinator. A data client with a non-empty `skipSources` subscribes to a derived Selection (`createSkipProjectedSelection`, newly exported) that never carries a skipped clause, so a change to a skipped source no longer issues a byte-identical query or flips `status` to `'pending'`. Kept clauses, `setInputs`, Params, `havingBy` and `refetch()` refresh exactly as before; resolver semantics (union / intersect / `empty` / crossfilter self-exclusion) are unchanged (nozzle/mosaic-adapters#229).
