# Sparkline client

`createSparklineClient(options)` — batched per-key series: one query serves every sparkline cell on a page (`WHERE key IN (…) GROUP BY key, x`). The sidecar pattern as a plain data client.

```ts
const sparklines = createSparklineClient({
  coordinator,
  from: 'athletes',
  key: 'sport',
  x: { column: 'weight', step: 5 },
  y: { agg: 'count' },
  filterBy: $page,
  inputs: { keys: ['swimming', 'athletics'] },
});
// sparklines.store.state.series → Map<key, Array<{x, y}>>
```

## Keys

`inputs.keys` is the serializable list of series to fetch — typically derived from a rows client's visible page (`[...new Set(rows.map((r) => r.sport))]`). It is value-diffed: re-rendering with the same keys never re-queries; a change re-queries exactly once. Empty/absent keys resolve to an empty series map. Without a `filterBy` selection the round trip is skipped entirely — no query is issued; a cross-filtered sparkline instead falls back to a trivial `WHERE FALSE` query, because upstream selection updates always expect a real query.

Dependent clients compose in userland through this input — there is no host coupling; the sparkline is just a client whose inputs happen to come from another client's store.

## Declarative x / y

- `x: { column }` — raw values (dates included).
- `x: { column, step }` — numeric bins: `floor(x / step) * step`.
- `x: { column, interval: 'hour' | 'day' | 'week' | 'month' | 'year' }` — date bins (DuckDB `time_bucket`); takes precedence over `step`.
- `y: { agg: 'count' | 'sum' | 'avg' | 'min' | 'max', column? }` — every agg except `'count'` requires a column (validated at creation).

`key`, `x.column`, and `y.column` accept struct paths (`'meta.country'` → `"meta"."country"`); names without a dot render exactly as before. `columnPaths: 'literal'` reads every dotted name as one identifier (`"meta.country"`) instead.

Points come back sorted by key then x; date x values surface as `Date`.

## Pre-aggregation

Filtering changes which `(key, x)` groups exist, so `filterStable` defaults to `false` for this client (overridable). That also puts its `filterBy` re-queries on the client's coalesced batch (opt out with `coalesceFilterBy: false`; see [one query per action](./concepts.md#one-query-per-action)).
