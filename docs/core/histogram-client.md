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
- `inputs.step` sets an exact bin width; `inputs.bins` is a step-count hint (default 25). Boundaries snap to nice numbers either way.
- `bins` on the store is contiguous across the whole extent — empty bins carry `count: 0`, so bar charts render gaps correctly.

## Publishing

`setRange([lo, hi])` publishes a native `clauseInterval` (BETWEEN, `meta: {type: 'interval'}`) with the client in the clause `clients` set: under a crossfilter Selection, the brush filters everything else on the page while this histogram's own bins stay put. `setRange(null)` clears; `range` on the store mirrors the published clause, including external removals; `destroy()` clears.
