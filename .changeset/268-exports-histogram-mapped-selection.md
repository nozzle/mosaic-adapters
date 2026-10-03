---
'@nozzleio/mosaic-core': minor
---

Export the query-result row helpers, the histogram binning helpers, and a general mapped Selection primitive.

- New `toResultRows(data)`, `firstResultRow(data)` and `resultRowCount(data)` exports read coordinator query results (Arrow tables or arrays). `firstResultRow` reads an Arrow table with `.get(0)` and `resultRowCount` reads `numRows`, so neither materializes a large result.
- New histogram helpers for building custom bin queries with the same binning as `createHistogramClient`: `histogramBinning`, `histogramExtentQuery`, `histogramSelect`, `histogramFilter` and `histogramBinsFromRows`, plus the `HistogramBase`, `HistogramBinOptions`, `HistogramBinning`, `HistogramBinningOptions`, `HistogramBinsResult`, `HistogramColumn`, `HistogramExtentQueryOptions` and `HistogramScale` types. The histogram client now uses them; its SQL is unchanged.
- New `createMappedSelection(parent, map, options?)`: a derived Selection whose clauses are `map` applied to each of the parent's clauses (`null` drops a clause). It relays like upstream `include`, follows snapshot-style parents by content, and returns a `MappedSelectionHandle` with `selection`, `refresh()` and `destroy()`. `MappedSelectionOptions` (an optional `resolver` override, defaulting to the parent's) and `SelectionClauseMap` are exported.
- `createSkipProjectedSelection` is now built on `createMappedSelection`. Its SQL and emissions are unchanged.
- **Behaviour note:** with a `Selection.single()` parent, a skip-projected or mapped Selection no longer calls `source.reset()` a second time on a clause the parent displaced. Upstream `include` relays do make that second call; the parent still resets the displaced source once.
