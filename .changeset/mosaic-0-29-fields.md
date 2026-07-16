---
'@nozzleio/mosaic-core': minor
'@nozzleio/react-mosaic': minor
'@nozzleio/mosaic-tanstack-table-core': minor
'@nozzleio/mosaic-tanstack-react-table': minor
---

Require `@uwdata/mosaic-core` and `@uwdata/mosaic-sql` `>=0.29.0`. Mosaic 0.29 adds a required `fields` property to the `SelectionClause` interface — the input field expressions a clause filters over — which the PreAggregator matches to predicate nodes by object identity. Every Selection clause this package constructs (value, subquery, clear, facet, and FilterSet emissions) now populates `fields`, sharing the exact column node instances referenced in each predicate so pre-aggregation keeps working. Clear clauses use the canonical empty form (`clauseNone`/`fields: []`). This is a breaking change for the peer-dependency range; consumers must upgrade their Mosaic packages to `>=0.29.0`.

`@nozzleio/mosaic-core` also gains a new export, `buildSubqueryClauseParts`, which returns both the `column [NOT] IN (SELECT ...)` predicate and the outer column node so consumers can populate a clause's `fields` with the identical node instance.
