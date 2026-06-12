---
'@nozzleio/mosaic-tanstack-table-core': patch
---

feat: record executed main-query SQL on the client store (`_lastQuery`)

Internal/experimental debug affordance: `MosaicDataTableStore._lastQuery`
holds the stringified SQL of the most recent main table query, set right
before submission to the coordinator. Marked `@internal`/`@experimental` —
not part of the supported API and may change or be removed in any release.
