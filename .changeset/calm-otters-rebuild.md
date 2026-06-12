---
'@nozzleio/mosaic-tanstack-table-core': patch
---

fix: prevent runaway rebuilds of subquery filters on sibling context changes

`reapplyCommittedFilterSelection` republishes a subquery filter's clause when
sibling context changes. Publishing relays synchronously back through the
scope context (Mosaic relays a clause update to derived selections before
committing its own value), re-entering the same listener while
`filter.selection.clauses` still reports the pre-update predicate. The
convergence guard therefore never matched and republished without bound,
overflowing the stack and unmounting the consuming table. Reentrant reapplies
for a selection are now suppressed while its publish settles.
