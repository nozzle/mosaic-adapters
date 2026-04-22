---
'@nozzleio/mosaic-tanstack-table-core': patch
---

fix(table-core): replace stale row-selection clauses across remounted clients

When a table was remounted as a new client, the previous client's
row-selection clause could remain in the shared Mosaic Selection.
Subsequent selection updates from the new client then intersected with
the stale clause, producing incorrect filters and stale KPI state.

Reset stale row-selection clauses before publishing the current
client's clause so shared row selection remains single-owner across
fullscreen or enlarged table transitions.

Add regression coverage for remount, replacement, and clear flows.
