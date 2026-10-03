# Histogram client

`createHistogramClient(options)` — binned counts of a numeric column in, interval clauses out. The data behind custom-rendered, brushable histograms.

```ts
const weight = createHistogramClient({
  coordinator,
  from: 'athletes',
  column: 'weight',
  inputs: { step: 5 },
  filterBy: $page,
  publish: { as: $page },
});
// weight.store.state → { bins: [{x0, x1, count}], maxCount, extent, range, … }
weight.setRange([60, 70]); // clauseInterval into $page; null clears
```

## Bins

Binning rides on mosaic-sql's `binHistogram` over a **fixed extent**, so filters change the counts, never the boundaries:

- `extent: [min, max]` pins the domain explicitly; otherwise the client discovers it once from the **unfiltered** base relation during `prepare` (before the first query).
- `scale: 'log'` spaces boundaries uniformly in log space and ignores non-positive values during discovery and bin queries. The default is `'linear'`.
- `inputs.step` sets an exact bin width (in transformed space for log scales); `inputs.bins` is a step-count hint (default 25). Linear boundaries snap to nice numbers; log boundaries stay pinned to the positive extent.
- `bins` on the store is contiguous across the whole extent — empty bins carry `count: 0`, so bar charts render gaps correctly.

## Building blocks

The client's binning is exported as pure helpers, for histograms drawn through another query path (a [rows client](./rows-client.md), a chart library's loader, a raw `coordinator.query()`). Bins built this way match the client's exactly. None of the helpers queries anything; you run the queries.

```ts
import {
  createRowsClient,
  firstResultRow,
  histogramBinning,
  histogramBinsFromRows,
  histogramExtentQuery,
  histogramFilter,
  histogramSelect,
} from '@nozzleio/mosaic-core';
import { Query, asc } from '@uwdata/mosaic-sql';

// 1. Discover the extent once, over the unfiltered relation.
const row = firstResultRow(await coordinator.query(histogramExtentQuery('athletes', 'weight')));
const binning = histogramBinning({ extent: [Number(row?.min), Number(row?.max)], step: 5 });

// 2. Query the bins under the page filters.
const weight = createRowsClient<{ x0: number; count: number }>({
  coordinator,
  filterBy: $page,
  query: ({ where }) =>
    Query.from('athletes')
      .select(histogramSelect('weight', binning))
      .where(where, histogramFilter('weight', binning))
      .groupby('x0')
      .orderby(asc('x0')),
});

// 3. Fold the rows into contiguous, zero-filled bins.
const { bins, maxCount } = histogramBinsFromRows(weight.store.state.rows, binning);
```

- `histogramBinning({ extent, scale?, step?, bins? })` resolves the bin options and boundaries. The options match the client's `extent`, `scale`, `inputs.step` and `inputs.bins`, and a log scale over a non-positive extent throws. Treat the returned `HistogramBinning` as opaque: always get one from `histogramBinning()` rather than constructing it by hand, since parts of it mirror mosaic-sql internals that may change with a mosaic-sql upgrade.
- `histogramExtentQuery(base, column, { scale?, columnPaths? })` selects `min`/`max` of the column. `base` is a table name, a `TableRefNode`, or a subquery.
- `histogramSelect(column, binning, { columnPaths? })` returns the `x0` (bin lower edge) and `count` select entries. Group by `x0`.
- `histogramFilter(column, binning, { columnPaths? })` returns the row filter the bins need: `IS NOT NULL`, plus `> 0` on a log scale.
- `histogramBinsFromRows(rows, binning)` returns `{ bins, maxCount }` in the client's store shape.

`column` is a column name (struct-path aware, with `columnPaths: 'literal'` as the opt-out) or a mosaic-sql expression. To publish a brush from a custom histogram, build a `clauseInterval` on the same column expression.

## Struct columns

`column` accepts a struct path: `column: 'stats.score'` bins `"stats"."score"`, and extent discovery, the bin query, and the published interval clause all share that one expression. Names without a dot render exactly as before. For a column whose name itself contains a dot, pass `columnPaths: 'literal'` to read it as one identifier (`"stats.score"`) everywhere, including the published clause. Under `publish.into` the mode travels on the `interval` spec (`columnPaths: 'literal'`), so the [FilterSet](./filter-set.md) resolves the same identifier.

## Publishing

`setRange([lo, hi])` publishes a native `clauseInterval` (BETWEEN, `meta: {type: 'interval'}`) with the client in the clause `clients` set: under a crossfilter Selection, the brush filters everything else on the page while this histogram's own bins stay put. `setRange(null)` clears; `range` on the store mirrors the published clause, including external removals; `destroy()` clears.

## Persistence

`persist?: Persister<[number, number]>` stores the brush range (see [concepts](./concepts.md#persistence)). A synchronous `read` hydrates after extent discovery but before the first main query; requires a `publish` target (a warning fires and persistence is ignored without one).
