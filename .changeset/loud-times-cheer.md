---
'@nozzleio/mosaic-tanstack-react-table': minor
'@nozzleio/mosaic-tanstack-table-core': minor
---

add HAVING routing for aggregate filters

Adds HAVING routing for aggregate filters while preserving WHERE routing for row-level filters.

Filter routing now supports both `where` and `having`, `havingBy` selections are applied to HAVING, and function-form table sources receive both routed predicates. Grouped tables can combine row filters in WHERE with aggregate filters in HAVING, and React filter-builder bindings can now apply and clear filters against a HAVING target.

This also adds an Aggregate Filter Lab example, extends the filter-builder example with an aggregate HAVING scope, and updates docs and tests for WHERE/HAVING behavior.

Includes follow-up fixes to keep grouped leaf row filters in WHERE even when grouped filter routing targets HAVING, and to reset pagination/requery correctly when aggregate filter selections change.
