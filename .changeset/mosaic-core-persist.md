---
'@nozzleio/mosaic-core': minor
---

Adds a generic persistence contract for filter _intent_ (never resolved SQL clauses): `Persister<TState>`, with `PersisterWriteReason` (`'update' | 'clear' | 'external'`) and `PersisterWriteContext`.

- New `persist` option on the facet, histogram, and rows clients. A synchronous `read` hydrates before the first query (no flash, no extra query); a thenable `read` hydrates on resolve and accepts a re-query. Writes are per-entry; hydration itself is never written back, and destroy-time clause cleanup never persists.
- External clause removals (chip bar, `selection.reset()`) now write with reason `'external'`.
- New replay setters: `facet.setSelected(values)` and `rows.setSelectedValues(tuples)`, for restoring stored intent where the original row objects no longer exist.
- The rows client now mirrors external clears of its select clause into its internal tuple tracking — previously untracked.

See `docs/core/concepts.md#persistence`.
