---
'@nozzleio/mosaic-core': minor
'@nozzleio/react-mosaic': minor
---

Accept a schema-qualified table as a query source, and read dotted column options in the facet, histogram, sparkline and pivot clients as struct paths.

- `QuerySource` now also accepts a `TableRefNode` from `@uwdata/mosaic-sql`: `new TableRefNode(['main', 'events'])` renders `FROM "main"."events"`. A plain string is still one identifier (`'main.events'` renders `FROM "main.events"`) and is never split; a dotted string logs a development-only warning, once per client, suggesting `TableRefNode`. An array source throws, since mosaic-sql renders `Query.from(['main', 'events'])` as a cross join.
- New `isSameQuerySource(a, b)` export. The React hooks use it to compare sources, so a `TableRefNode` built inline on every render is compared by its SQL form instead of identity.
- The facet, histogram, sparkline and pivot clients resolve dotted column options as struct paths, matching the rows client and FilterSet: `meta.country` renders `"meta"."country"` instead of `"meta.country"`. The same expression is used for the published clause `fields`. The pivot client projects struct paths onto the source under their dotted names, since DuckDB rejects qualified references inside `PIVOT`. SQL for names without a dot is unchanged.
- **Behaviour change for dotted column names:** a column whose name itself contains a dot now needs the new `columnPaths: 'literal'` option (on the four clients and their hooks) to keep the previous single-identifier SQL. `FilterSpec.columnPaths` carries the same choice to the FilterSet, and `ColumnPathMode`/`ColumnPathOptions` are exported.
