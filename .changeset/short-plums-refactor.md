---
'@nozzleio/mosaic-core': patch
---

Rollup client: the pre-order `ORDER BY` now reads each groupBy column's
subtotal flag as a bit off the already-selected `GROUPING()` mask instead of
issuing a redundant `GROUPING()` call per column. Emitted SQL and row
ordering are unchanged.
