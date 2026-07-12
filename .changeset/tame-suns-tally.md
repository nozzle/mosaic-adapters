---
'@nozzleio/mosaic-core': patch
---

Rows clients with `rowCount: 'query'` now memoize the standing count query and re-issue it only when the WHERE/HAVING/base predicate changes (and on an explicit `refetch()`). Page turns and sort changes strip `orderBy`/`limit`/`offset` from the count SQL, so they no longer enqueue a redundant count request/promise round trip; `totalRows` holds its previous value. `refetch()` forces a fresh count in case the underlying data changed with an unchanged predicate.
