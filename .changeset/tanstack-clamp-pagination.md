---
'@nozzleio/mosaic-tanstack-table-core': minor
---

Add `clampPagination(pagination, totalRows)` — clamps a stale `pageIndex` into range when a filter shrinks the result set below the current page (the sharp edge of the manual-pagination model, where an unclamped index otherwise renders an empty table with a broken pager). `totalRows` of `0`/`undefined` clamps to page 0; the input is returned unchanged when already in range. Under `rowCount: 'window'`, past-the-end recovers only to page 0 (`totalRows: 0` is ambiguous there); use `rowCount: 'query'` for exact last-page recovery.
