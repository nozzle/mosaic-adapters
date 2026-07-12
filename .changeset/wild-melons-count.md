---
'@nozzleio/mosaic-core': patch
---

Rows client `rowCount: 'window'` now wraps the base query in a subquery
(`SELECT *, count(*) OVER () FROM (<base>)`) instead of appending the window
expression alongside the base's own columns. Appending in-scope silently
miscounted a `DISTINCT` base — the window saw pre-dedup rows — and could not
attach to a set-operation base at all. Ordering, limit, and offset now apply to
the outer wrapper, matching the shape the `'query'` count path already produces.
