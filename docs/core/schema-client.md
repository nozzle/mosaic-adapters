# Schema client

`createSchemaClient(options)` — read-once schema discovery over upstream `queryFieldInfo`: column names, SQL/JS types, nullability, and optional summary stats. The inputs for column-def generation and facet/histogram domain inference.

```ts
const schema = createSchemaClient({
  coordinator,
  table: 'athletes',
  columns: ['weight', 'height'],
  stats: ['min', 'max', 'distinct'],
});
// schema.store.state → { status, error, fields: Array<FieldInfo> }
```

- `columns: '*'` (default) describes every column via `DESCRIBE` (types and nullability, no stats).
- Named columns fetch per-column info plus the requested stats (`'count' | 'nulls' | 'min' | 'max' | 'distinct'`).

Unlike the other clients this is **not** a `MosaicClient`: schema is not Selection-reactive, so there is no `filterBy` and nothing re-queries. Call `refetch()` if the table itself is replaced; `destroy()` stops any in-flight read from landing.

Field-info requests call `coordinator.query()` directly rather than the
`updateClient()` lifecycle that wraps main-query failures. A failed schema read
therefore surfaces as a plain `Error` in `schema.store.state.error`, not
necessarily as Mosaic 0.30's `QueryError`.
