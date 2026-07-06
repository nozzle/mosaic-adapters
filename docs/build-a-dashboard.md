# Build a dashboard

The canonical getting-started walkthrough. It builds the athletes dashboard
from [`examples/react/athletes`](../examples/react/athletes) — KPI cards, a
native vgplot scatterplot, and a fully server-side TanStack table, all
cross-filtering through **one** Mosaic Selection. Every piece of data the page
renders flows through a data client; every data operation executes in SQL.

Install the two framework packages (each re-exports its core in full — no peer
installs):

```bash
pnpm add @nozzleio/react-mosaic @nozzleio/mosaic-tanstack-react-table
```

You will also use upstream Mosaic directly — that is by design. Selections,
Params, SQL builders, and vgplot are the native vocabulary, not wrapped
concepts:

```bash
pnpm add @uwdata/mosaic-core @uwdata/mosaic-sql @uwdata/vgplot @tanstack/react-table
```

## 1. A coordinator and a table

Mosaic's coordinator brokers every query. Point the global one at an
in-browser DuckDB and load the data — plain upstream Mosaic, nothing from us
yet:

```ts
// mosaic-setup.ts
import { coordinator, wasmConnector } from '@uwdata/mosaic-core';

let initPromise: Promise<void> | null = null;

export function initAthletesTable(): Promise<void> {
  if (initPromise === null) {
    initPromise = (async () => {
      coordinator().databaseConnector(wasmConnector());
      await coordinator().exec([
        `CREATE TABLE IF NOT EXISTS athletes AS SELECT * FROM '${PARQUET_URL}'`,
      ]);
    })();
  }
  return initPromise;
}
```

Gate rendering on this promise (see the example's `App.tsx`). The client hooks
default to this same global coordinator; pass one explicitly via
`MosaicProvider` or the `coordinator` option if you manage your own. For an
app-owned coordinator with reconnect handling instead of the global singleton,
see the [connector lifecycle recipe](react/connector-lifecycle.md); for turning
this ad-hoc load into a serializable, per-table-tracked one, the
[data loading recipe](react/data-loading.md).

## 2. The page context: one Selection

One `Selection.crossfilter()` is the page's entire filter context. Every
filter UI publishes clauses into it; every client consumes it via `filterBy`.
Native cross-mode resolution excludes each publisher from its own clause, so
views cascade correctly with no extra machinery ([concepts](core/concepts.md)):

```ts
// page-context.ts
import { Param, Selection } from '@uwdata/mosaic-core';

export const $page = Selection.crossfilter();

// Rows picked in the table fan out to detail panes, comparison views, etc.
// Deliberately NOT part of $page — no feedback loop.
export const $picked = Selection.union();

// Drives which medal column the KPIs aggregate.
export const $metric = Param.value<'gold' | 'silver' | 'bronze'>('gold');
```

## 3. KPI cards — the values client

One [values client](core/values-client.md) serves every card in a single
round trip: a single-row aggregate query whose columns become a typed record.
Listing `$metric` in `params` re-queries it whenever the Param changes
(upstream never does this automatically):

```tsx
const kpis = useMosaicValues<{ athletes: number; medals: number | null }>({
  query: ({ where }) =>
    Query.from('athletes')
      .select({ athletes: count(), medals: sum(column($metric.value!)) })
      .where(where),
  filterBy: $page,
  params: { metric: $metric },
});

// kpis.values?.athletes, kpis.values?.medals, kpis.status
```

`where` is the resolved page predicate — `[]` when unfiltered, so
`.where(where)` needs no guard. Change `$metric` with `$metric.update('silver')`.

## 4. The scatterplot — native vgplot

vgplot marks are Mosaic clients on the same coordinator, so handing them
`$page` cross-filters them with everything above — and the brush publishes
back into `$page`, filtering the KPIs and the table.
[`useVgPlot`](react/use-vg-plot.md) is mounting sugar only:

```tsx
const plotRef = useVgPlot(() =>
  vg.plot(
    vg.dot(vg.from('athletes', { filterBy: $page }), {
      x: 'weight',
      y: 'height',
      fill: 'sex',
      r: 2,
      opacity: 0.1,
    }),
    vg.intervalXY({
      as: $page,
      brush: { fillOpacity: 0, stroke: 'currentColor' },
    }),
    vg.xyDomain(vg.Fixed),
  ),
);
return <div ref={plotRef} />;
```

Because `$page` is a crossfilter Selection, the brush filters every _other_
view while the scatterplot keeps showing the full distribution.

## 5. The table — rows client + manual-mode TanStack

You own `useReactTable`, in fully manual mode: `getCoreRowModel` is the only
row model, and `data`/`rowCount` come verbatim from a
[rows client](core/rows-client.md). Sorting and pagination travel as
serializable inputs — the client appends `ORDER BY`/`LIMIT`/`OFFSET` in SQL.
Column filters become `$page` clauses through the
[TanStack filter bridge](tanstack/integration.md), so they filter the KPIs
and the scatterplot too:

```tsx
const [sorting, setSorting] = useState<SortingState>([]);
const [pagination, setPagination] = useState<PaginationState>({
  pageIndex: 0,
  pageSize: 25,
});
const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

// Column ids must match the config exactly — unconfigured ids are ignored.
useTanStackFilterBridge({
  filters: columnFilters,
  selection: $page,
  columns: {
    name: { clause: 'ilike' },
    sport: { clause: 'equals' },
    weight: { clause: 'range' },
  },
});

const athletes = useMosaicRows<AthleteRow>({
  query: ({ where }) =>
    Query.from('athletes')
      .select(
        'id',
        'name',
        'nationality',
        'sport',
        'sex',
        'height',
        'weight',
        'gold',
      )
      .where(where),
  filterBy: $page,
  inputs: {
    orderBy: sortingToOrderBy(sorting), // serializable intent in…
    ...paginationToWindow(pagination), // { limit, offset }
  },
  rowCount: 'window', // COUNT(*) OVER () → totalRows
  publish: { select: { as: $picked, columns: ['id'] } },
});

const table = useReactTable({
  data: athletes.rows, // …data out, verbatim
  rowCount: athletes.totalRows,
  columns,
  state: { sorting, pagination, columnFilters },
  onSortingChange: setSorting,
  onPaginationChange: setPagination,
  onColumnFiltersChange: setColumnFilters,
  manualSorting: true,
  manualFiltering: true,
  manualPagination: true,
  getCoreRowModel: getCoreRowModel(), // the only row model
  getRowId: (row) => String(row.id),
});
```

Render it as any TanStack table. A row click publishes a native point clause
into `$picked` for downstream consumers:

```tsx
<tr onClick={() => athletes.client.selectRows([row.original])}>
```

In practice, reset `pageIndex` inside your `onSortingChange`/
`onColumnFiltersChange` handlers — manual mode disables TanStack's auto-reset.

Those handlers only cover filters born in TanStack state. Any other `$page`
publisher — a vgplot brush, a facet toggle, a histogram range — can shrink
`totalRows` below the current offset with no handler involved, stranding the
table on an empty page. Clamp against the client's `totalRows` (with
`rowCount: 'window'` a stranded offset returns zero rows and the total reads
0, so the clamp resolves to page one):

```tsx
useEffect(() => {
  if (athletes.totalRows === undefined) {
    return;
  }
  const pageCount = Math.ceil(athletes.totalRows / pagination.pageSize);
  if (pagination.pageIndex > 0 && pagination.pageIndex >= pageCount) {
    setPagination((prev) => ({
      ...prev,
      pageIndex: Math.max(0, pageCount - 1),
    }));
  }
}, [athletes.totalRows, pagination.pageIndex, pagination.pageSize]);
```

## What you get

Running the example ([`examples/react/athletes`](../examples/react/athletes)):

- sorting, pagination, and filtering execute in SQL — check `athletes.lastQuery`;
- brushing the scatterplot, toggling the sport facet, or clicking a histogram
  bar filters the table and KPIs — while each control's own data stays
  unaffected by its own clause (crossfilter self-exclusion);
- a column filter filters the scatterplot and KPIs;
- switching the KPI metric re-queries only the values client;
- one batched sparkline client feeds every table cell through
  `table.options.meta`;
- `?view=rollup` and `?view=pivot` show the SQL-first grouped clients.

Its Playwright suite asserts each of those flows end-to-end.

## Going further

- [Data client concepts](core/concepts.md) — the contract behind every client.
- [Rows client](core/rows-client.md) / [values client](core/values-client.md) — full options.
- [Facet](core/facet-client.md) / [histogram](core/histogram-client.md) /
  [sparkline](core/sparkline-client.md) clients — filter UIs and batched
  per-key series.
- [Rollup](core/rollup-client.md) / [pivot](core/pivot-client.md) clients —
  SQL-first grouping and crosstabs. [Schema client](core/schema-client.md) —
  read-once field discovery.
- [Filter set](core/filter-set.md) — declarative, persistable filter specs over
  Selections, with active-filter chips and global reset.
- [Selection topology](core/selection-topology.md) — declare a page's named
  Selection graph as data so widgets reference selections by name (spec-driven
  dashboards); its [React bindings](react/topology.md) and
  [recipes](react/topology-recipes.md) (page-wide reset, active-filter chips).
- [Membership subqueries](core/subquery-predicates.md) — `IN (SELECT …)`
  predicates, context embedding, and change-suppressed republishing.
- [React hooks](react/hooks.md) — controlled-binding rules (what recreates a client, what never re-queries).
- [TanStack integration](tanstack/integration.md) — translators, clause kinds, bridge lifecycle, and when _not_ to use the bridge.
- The [`nozzle-paa` example](../examples/react/nozzle-paa) — a bigger page
  (four cross-filtering summary tables, membership subqueries, chip bar) built
  on a static per-widget Selection topology composed with native
  `include` lists instead of one crossfilter — its README explains when each
  shape fits.
