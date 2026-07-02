# TanStack Table integration

`@nozzleio/mosaic-tanstack-react-table` is the only TanStack-aware layer in the stack. Install this package only — it re-exports the full `@nozzleio/mosaic-tanstack-table-core` public API (the same distribution model as `@nozzleio/react-mosaic`; the glue core is a regular dependency, never a peer).

The model is strictly server-side: Mosaic is the server, TanStack Table is a client in fully manual mode. The table renders `data` and `rowCount` verbatim from a [rows client](../core/rows-client.md) and never re-processes rows — `getCoreRowModel` is the only row model. The glue translates TanStack state _into_ the native path (serializable inputs and Selection clauses); `@nozzleio/mosaic-core` never imports TanStack, and the bridge never touches a data client.

## Manual-mode wiring

You own `useReactTable` and its state, exactly where TanStack manual mode wants it. Sorting and pagination become serializable rows-client inputs through two pure translators:

- `sortingToOrderBy(sorting, columnMap?)` → `Array<OrderByItem>` — TanStack column ids are used as SQL column names unless remapped via `columnMap`.
- `paginationToWindow(pagination)` → `{ limit, offset }`.

```tsx
import { useState } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  type ColumnFiltersState,
  type PaginationState,
  type SortingState,
} from '@tanstack/react-table';
import { Selection } from '@uwdata/mosaic-core';
import { Query } from '@uwdata/mosaic-sql';
import { useMosaicRows } from '@nozzleio/react-mosaic';
import {
  paginationToWindow,
  sortingToOrderBy,
  useTanStackFilterBridge,
} from '@nozzleio/mosaic-tanstack-react-table';

const $page = Selection.crossfilter();

function AthletesTable() {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 25,
  });
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  // Opt-in: TanStack columnFilters state → clauses on the page Selection.
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
        .select('id', 'name', 'sport', 'weight')
        .where(where),
    filterBy: $page,
    inputs: {
      orderBy: sortingToOrderBy(sorting), // serializable intent in…
      ...paginationToWindow(pagination), // { limit, offset }
    },
    rowCount: 'window',
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

  // …plain TanStack rendering.
}
```

## The filter bridge

`useTanStackFilterBridge({ filters, selection, columns })` publishes one Selection clause per actively filtered column, using the same clause factories every other Mosaic publisher (brush, facet, menu) uses. `column.setFilterValue()` and ecosystem filter components then work unmodified — the data layer only ever sees a Selection.

Per-column config maps a TanStack column id to `{ column?, clause }`, where `column` defaults to the id (dotted paths are struct access: `related_phrase.phrase` → `"related_phrase"."phrase"`) and `clause` is one of:

| Kind           | Filter value                | Clause                                                                                     |
| -------------- | --------------------------- | ------------------------------------------------------------------------------------------ |
| `'equals'`     | any value                   | null-safe equality (`clausePoint`); explicit `null` matches SQL NULLs, `undefined` clears  |
| `'ilike'`      | string                      | case-insensitive contains (`clauseMatch`); empty string clears                             |
| `'prefix'`     | string                      | case-insensitive prefix (`clauseMatch`); empty string clears                               |
| `'range'`      | `[lo, hi]` numbers          | `BETWEEN` (`clauseInterval`); either bound may be open → plain `>=`/`<=`; both open clears |
| `'date-range'` | `[lo, hi]` Dates or strings | like `'range'` with bounds coerced to `Date` literals                                      |
| `'in'`         | array                       | membership (`clausePoints`); a scalar becomes a one-element list, an empty array clears    |

Filters on column ids without a config entry are deliberately ignored — they are yours to route elsewhere (or not at all).

### Clause lifecycle

The bridge owns its clauses precisely, because every Selection update re-queries every consumer:

- **Stable identity** — one clause source per column id, held for the bridge's lifetime: a changed filter value _replaces_ the clause, never accumulates.
- **Removal** — clearing a column filter removes exactly its clause; unmount (or a `selection` identity change) removes all of them.
- **Echo suppression** — publishes are value-diffed. Re-renders with equal filter state (fresh array/object identities included) publish nothing, so store-update → re-render → bridge cycles cannot feed back into Selection activations.
- **No self-exclusion** — unlike brush/facet publishers, bridge clauses carry no `clients` set, so the table _is_ filtered by its own column filters, even inside a `Selection.crossfilter()`. That is the point: column filters describe the table's contents.
- **Source descriptors** — bridge clause sources carry `{ id, column }`, so downstream consumers (the filter registry's chips) can label a clause without reaching into TanStack state.

### External clears: who wins?

Someone other than the table can remove a bridge clause — an active-filter chip bar's X, a global `selection.reset()`. Two behaviors are available:

- **Default (state-authoritative)** — TanStack `columnFilters` state is the source of truth: the next state sync republishes the clause a reset removed. Right when nothing else manages these clauses.
- **`onExternalClear(columnIds)`** — the external clear wins: the bridge suppresses republishing and reports which TanStack column ids lost their clauses so you prune the state (and with it the filter inputs):

```tsx
useTanStackFilterBridge({
  filters: columnFilters,
  selection: $detail,
  columns: bridgeColumns,
  onExternalClear: (columnIds) =>
    setColumnFilters((prev) => prev.filter((f) => !columnIds.includes(f.id))),
});
```

Pass it whenever the Selection is registered with a filter registry / chip bar. Held by latest-ref — a new function identity never recreates the bridge.

Framework-agnostic consumers can use the core directly: `createFilterBridge({ selection, columns, onExternalClear? })` with `setFilters` / `setColumns` / `destroy`.

## When not to use the bridge

The bridge exists for one case: you want TanStack's filter _state model_ (`columnFilters`, `column.setFilterValue()`, existing filter UI components) on a Mosaic-backed table. The native path is Selections, and filter UIs built for Mosaic should publish clauses directly:

- Facet menus, histogram brushes, vgplot interactors, and the filter-builder publish straight into the page Selection — no TanStack state in the loop, no bridge.
- The bridge's clause kinds are deliberately simple, one clause per column. Composite predicates, OR groups, or subquery filters belong to native publishers built on the core clause factories.
- If your filter UI does not need to live in TanStack table state, skip `manualFiltering`/`columnFilters` entirely and let the rows client's `filterBy` do the work.

Sorting and pagination are different: those translators are just data mapping with no lifecycle, and are always the right tool when the state lives in TanStack.
