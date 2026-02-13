# Real-World React Examples

These examples are the fastest way to see how the libraries are used in practice.

## Athletes (Full)

`examples/react/trimmed/src/components/views/athletes.tsx`

- Shows topology with histograms, table filters, and chart brushing
- Uses `createMosaicMapping` + `createMosaicColumnHelper`
- Demonstrates hover selection wiring

## Athletes (First Principles)

`examples/react/trimmed/src/components/views/athletes-simple.tsx`

- Inline `column.meta.mosaicDataTable` config
- Minimal cross-filtering with `$query`, `$tableFilter`, `$combined`
- Simple vgplot inputs + chart + table integration

## PAA Dashboard

`examples/react/trimmed/src/components/views/nozzle-paa.tsx`

- Multi-table topology with `usePaaTopology`
- KPI queries using `useMosaicValue`
- Active filter bar + global reset
- Summary tables using `rowSelection` + `manualHighlight`

## Athletes (Grouped Table)

`examples/react/trimmed/src/components/views/athletes.tsx` — `AthletesGroupedTable` component

- Server-side hierarchical grouping: Country → Sport → Gender
- Uses `useServerGroupedTable` with 3 group levels and 4 aggregation metrics
- Leaf rows with `leafSelectAll: true` show individual athlete detail
- Integrates with existing athletes topology for cross-filtering
- See [Grouped Table Guide](./grouped-table.md) for full documentation
