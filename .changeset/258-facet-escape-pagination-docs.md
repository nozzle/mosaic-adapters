---
'@nozzleio/mosaic-core': patch
'@nozzleio/mosaic-tanstack-table-core': patch
---

Facet client `search` now matches `%`, `_` and `\` literally, like upstream's `clauseMatch` 'contains' mode. The search text is escaped and the `ILIKE` uses `ESCAPE '\'`, so searching `0%` no longer matches `1000`. The `clampPagination` JSDoc now shows applying it to the pagination state in an effect after the total settles, not during render.
