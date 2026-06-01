---
'@nozzleio/mosaic-tanstack-react-table': minor
'@nozzleio/mosaic-tanstack-table-core': minor
---

add explicit SQL filter clause routing

Add explicit SQL filter clause routing for adapter-emitted predicates.

This introduces a WHERE-only `SqlFilterClauseTarget` surface and routes generated predicates through explicit clause placement instead of applying them directly at each call site. Existing SQL behavior is preserved: all routed predicates still land in `WHERE`.

Breaking change: function-form table sources now receive a routed filter object instead of the filter predicate directly.

```diff
- table: (filter) => {
+ table: ({ where }) => {
    const query = mSql.Query.from("athletes").select("*");

-   if (filter) {
-     query.where(filter);
+   if (where) {
+     query.where(where);
    }

    return query;
  }
```

Also added public API.

```ts
type SqlFilterClauseTarget = 'where';

type MosaicColumnMeta = {
  filterClauseTarget?: SqlFilterClauseTarget;
};

type MosaicDataTableOptions = {
  globalFilterClauseTarget?: SqlFilterClauseTarget;
  havingBy?: Selection;
  groupBy?: {
    filterClauseTarget?: SqlFilterClauseTarget;
  };
};
```
