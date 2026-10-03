---
'@nozzleio/mosaic-core': minor
---

Filter kinds gain a regex operator, array-aware text operators, composite-key subqueries and an aggregate-threshold kind. All additions are opt-in; existing specs emit the same SQL.

- `conditionFilterKind` accepts `matches` / `not_matches` (DuckDB `regexp_matches`, RE2 syntax, case-sensitive unless the pattern uses `(?i)`). An empty value leaves the spec inactive.
- With `columnType: 'array'`, the text operators (`contains`, `starts_with`, `ends_with`, `matches` and their `not_*` forms) now test the list's elements: the positive form keeps rows where any element matches, the `not_*` form keeps rows where no element matches. Previously they applied `ILIKE` to the list itself.
- `subqueryFilterKind(build, { columns })` and `buildSubqueryClauseParts({ column: [...] })` accept several outer columns for a composite key, emitting `(a, b) [NOT] IN (SELECT a, b ...)`. `buildSubqueryClauseParts` now also returns `fields`, the column nodes embedded in the predicate; a subquery kind's emission lists every outer column in `fields`. Passing an empty column list throws.
- New `aggregateThresholdFilterKind({ from, aggregate, targets: { having, members }, operators? })` keeps the groups of a spec's `column` whose aggregate passes `operator value`. It emits the bare aggregate comparison on `targets.having` (for `havingBy`) and a `column IN (SELECT column ... GROUP BY column HAVING ...)` membership clause on `targets.members`, rebuilt when the context Selection changes. `THRESHOLD_OPERATORS` lists its operator vocabulary.

New exported types: `AggregateThresholdKindOptions`, `SubqueryClauseParts`, `SubqueryColumn`, `SubqueryFilterKindOptions` and `ThresholdOperator`.
