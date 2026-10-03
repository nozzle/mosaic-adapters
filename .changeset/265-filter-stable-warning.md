---
'@nozzleio/mosaic-core': patch
---

Make the rows client's defaulted-`filterStable` warning match when Mosaic's pre-aggregation can actually apply. It now fires only when a `filterBy` Selection is set, `filterStable` was left defaulted (and not forced off by `skipSources`), and the query Mosaic sees has an outer aggregate. Besides `GROUP BY`, it now recognises `SELECT DISTINCT`, `QUALIFY`, window functions and `PIVOT`, including inside `Query.with()` CTEs, FROM subqueries and set operation members. The check runs on the final query (so the `rowCount: 'window'` wrapper no longer warns) and is retried on each build until it fires once. The message explains what `filterStable: true` promises. Defaults and query behaviour are unchanged; any explicit `filterStable` still silences the warning. The `filterStable` docs and option JSDoc are clarified to match.
