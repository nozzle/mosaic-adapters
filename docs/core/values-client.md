# Values client

`createValuesClient<TValues>(options)` — a single-row aggregate query whose columns become a typed record. One round trip serves any number of KPI cards.

```ts
const kpis = createValuesClient<{ athletes: number; medals: number }>({
  coordinator,
  query: ({ where }) =>
    Query.from('athletes')
      .select({ athletes: count(), medals: sum('gold') })
      .where(where),
  filterBy: $page,
  params: { metric: $metric }, // Param changes re-query automatically
});

kpis.store.state.values; // { athletes: 11538, medals: 1914 } | undefined
```

- The query must resolve to a single row; the client reads the first row of the result. `values` is `undefined` before the first result and for empty results.
- Everything else is the base contract: `filterBy`/`havingBy` routing, `params` wiring, `setEnabled`, `refetch`, `destroy`, `mosaicClient`.
- The client carries no serializable inputs (`ValuesInputs = {}`); vary the query through Params or Selections instead.
