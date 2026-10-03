# TanStack Table integration

`@nozzleio/mosaic-tanstack-react-table` is the only TanStack Table-aware layer in the stack. Install this package only — it re-exports the full `@nozzleio/mosaic-tanstack-table-core` public API (the same distribution model as `@nozzleio/react-mosaic`; the glue core is a regular dependency, never a peer).

## TanStack Table v9

The library targets TanStack Table v9 — install `@tanstack/react-table@beta` (v9 is not yet the npm `latest` tag). TanStack Table is a peer dependency of the glue packages, matching what you install: `@nozzleio/mosaic-tanstack-react-table` peers on `@tanstack/react-table`, and the framework-agnostic `@nozzleio/mosaic-tanstack-table-core` peers on `@tanstack/table-core` (satisfied transitively by any TanStack Table framework adapter). The glue's public API is unchanged across the v8→v9 migration; the new v9 surfaces (`table.atoms`, `<table.Subscribe>`, `createTableHook`) are intentionally not used by the glue — you wire `useTable` and its state yourself, exactly as below.

The model is strictly server-side: Mosaic is the server, TanStack Table is a client in fully manual mode. The table renders `data` and `rowCount` verbatim from a [rows client](../core/rows-client.md) and never re-processes rows — the core row model (built in under v9) is the only row model, and a manual-mode table registers no other row-model factories. The glue translates TanStack Table state _into_ the native path (serializable inputs and Selection clauses); `@nozzleio/mosaic-core` never imports TanStack Table, and the bridge never touches a data client.

## Manual-mode wiring

You own `useTable` and its state, exactly where TanStack Table manual mode wants it. Sorting and pagination become serializable rows-client inputs through two pure translators:

- `sortingToOrderBy(sorting, columnMap?)` → `Array<OrderByItem>` — TanStack Table column ids are used as SQL column names unless remapped via `columnMap`.
- `paginationToWindow(pagination)` → `{ limit, offset }`.
- `clampPagination(pagination, totalRows)` → `PaginationState` — clamp a stale `pageIndex` into `[0, lastPage]` when a filter shrinks the result under the current page. This is the sharp edge of the manual-pagination model: an unclamped `pageIndex` renders an empty table with a broken pager and no error. `totalRows` of `0`/`undefined` → page 0; a `pageIndex` already in range is returned unchanged. **Caveat:** under `rowCount: 'window'`, `totalRows: 0` is ambiguous between "empty result" and "past the end", so past-the-end recovers only to page 0, not the true last page — use `rowCount: 'query'` when exact last-page recovery matters. Apply it to the table's `pagination` state in an effect — see [Clamping a stale page](#clamping-a-stale-page).

```tsx
import { useEffect, useState } from 'react';
import {
  columnFilteringFeature,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type ColumnFiltersState,
  type PaginationState,
  type SortingState,
} from '@tanstack/react-table';
import { Selection } from '@uwdata/mosaic-core';
import { Query } from '@uwdata/mosaic-sql';
import { createFilterSet, useMosaicRows } from '@nozzleio/react-mosaic';
import {
  clampPagination,
  paginationToWindow,
  sortingToOrderBy,
  useTanStackTableFilterBridge,
} from '@nozzleio/mosaic-tanstack-react-table';

// v9 requires an explicit feature set; register exactly the features this
// table's state uses (sorting, pagination, column filtering). The core row
// model is built in — no `getCoreRowModel`.
const features = tableFeatures({
  rowSortingFeature,
  rowPaginationFeature,
  columnFilteringFeature,
});

const $page = Selection.crossfilter();
// The bridge translates column filters into specs on a page-level FilterSet,
// which publishes them as clauses on `$page` (target `where`).
const filterSet = createFilterSet({ targets: { where: $page } });

function AthletesTable() {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 25,
  });
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  // Opt-in: TanStack Table columnFilters state → specs on the page FilterSet.
  useTanStackTableFilterBridge({
    filters: columnFilters,
    set: filterSet,
    columns: {
      name: { clause: 'ilike' },
      sport: { clause: 'equals' },
      weight: { clause: 'range' },
    },
  });

  const athletes = useMosaicRows<AthleteRow>({
    query: ({ where }) =>
      Query.from('athletes').select('id', 'name', 'sport', 'weight').where(where),
    filterBy: $page,
    inputs: {
      orderBy: sortingToOrderBy(sorting), // serializable intent in…
      ...paginationToWindow(pagination), // { limit, offset }
    },
    rowCount: 'window',
  });

  // Clamp the table's own pagination state once the total settles (see
  // "Clamping a stale page" below).
  const { totalRows } = athletes;
  useEffect(() => {
    if (totalRows === undefined) {
      return;
    }
    setPagination((prev) => clampPagination(prev, totalRows));
  }, [totalRows]);

  const table = useTable({
    features, // v9: the built-in feature set declared above
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
    getRowId: (row) => String(row.id),
  });

  // …plain TanStack Table rendering.
}
```

### Clamping a stale page

Any `$page` publisher — a column filter, a facet toggle, a brush, a chip bar's X — can shrink `totalRows` below the current offset. The canonical recipe clamps the table's `pagination` state (not just the query window) in an effect keyed on `totalRows`:

```tsx
const { totalRows } = athletes;
useEffect(() => {
  // No total yet (first load, or `rowCount: 'none'`): nothing to clamp
  // against. Without this guard a restored `pageIndex` resets to 0 on mount.
  if (totalRows === undefined) {
    return;
  }
  setPagination((prev) => clampPagination(prev, totalRows));
}, [totalRows]);
```

`clampPagination` returns `prev` unchanged when the page is already in range, so the state setter bails out and an in-range total costs no re-render. The effect is keyed on `totalRows` only: a page-size change needs no re-clamp, because TanStack Table's `setPageSize` already re-derives `pageIndex` from the top visible row.

Why an effect that writes `pagination`, rather than a clamp during render:

- **Clamp the state, not a derived copy.** Clamping only the value fed to `paginationToWindow` (or to the table's `state`) leaves your `pagination` state on the stale page: anything reading it — a "Page N" label, URL sync — disagrees with the table, and the stale index resurfaces as soon as the total grows back (clearing the filter jumps the user back to the old page).
- **A store write during render flushes mid-render.** The pagination state is often not a plain `useState` in the reading component: it lives in an atom, a router's search params, or the table's own store (uncontrolled `pagination`). Writing any of these during render notifies their subscribers synchronously, in the middle of React's render pass. React flags it ("Cannot update a component while rendering a different component"), and every notified subscriber re-renders and runs the clamp again. If that write produces a fresh object, even an equal one, the store notifies again and the render never settles.
- **TanStack Table v9's setters always produce a new state object.** The obvious render-time clamp, `table.setPageIndex(Math.min(pageIndex, lastPage))`, builds a new `{ ...old, pageIndex }` on every call, even when the index doesn't change. With controlled `state: { pagination }`, React compares that object to the current state by identity, sees a change, re-renders, and the clamp runs again. React aborts with "Too many re-renders". `clampPagination` returns the same object when nothing moved, which breaks this cycle — but only when you call it on the state setter directly, never through the table's page setters.

The effect avoids all three: it runs once per committed `totalRows` change, after render, writes through the state owner's own setter, and works wherever the pagination state lives. It costs one extra commit. TanStack Table v9 syncs controlled `state` into its store after commit, so the clamped value reaches the table on the next render.

### Mirroring the row selection into `rowSelection`

A rows client with `publish.select` exposes what it published as `selected` — tuples aligned to `publish.select.columns` (see [the rows client](../core/rows-client.md#publishing)). Derive TanStack Table's `rowSelection` from it rather than storing a second copy, and route `onRowSelectionChange` back through `setSelectedValues`. The only glue you supply is `toId`, which turns a selected tuple into the same id your `getRowId` returns:

```tsx
import { useMemo } from 'react';
import {
  functionalUpdate,
  rowSelectionFeature,
  type OnChangeFn,
  type RowSelectionState,
} from '@tanstack/react-table';

const $picked = Selection.crossfilter();

// Consumer-supplied: a tuple aligned to `publish.select.columns` → row id.
// It must agree with `getRowId` below.
const toId = (tuple: ReadonlyArray<unknown>) => String(tuple[0]);
const toTuple = (row: AthleteRow) => [row.id];

const athletes = useMosaicRows<AthleteRow>({
  // …query, filterBy, inputs as above…
  publish: { select: { as: $picked, columns: ['id'] } },
});
const { selected, rows, client } = athletes;

// Derived, never stored: the published selection is the one source of truth,
// so persisted hydration, a chip bar's X or `$picked.reset()` show up here too.
const rowSelection = useMemo<RowSelectionState>(
  () => Object.fromEntries(selected.map((tuple) => [toId(tuple), true])),
  [selected],
);

const onRowSelectionChange: OnChangeFn<RowSelectionState> = (updater) => {
  const next = functionalUpdate(updater, rowSelection);
  // Every tuple we can name: the current selection (which may include rows
  // on other pages) plus the visible page.
  const byId = new Map<string, ReadonlyArray<unknown>>();
  for (const tuple of selected) {
    byId.set(toId(tuple), tuple);
  }
  for (const row of rows) {
    const tuple = toTuple(row);
    byId.set(toId(tuple), tuple);
  }
  const tuples = Object.keys(next).flatMap((id) => {
    const tuple = byId.get(id);
    if (tuple === undefined) {
      return [];
    }
    return [tuple];
  });
  client.setSelectedValues(tuples); // [] clears the clause
};

const table = useTable({
  // Register `rowSelectionFeature` alongside the others in `tableFeatures`.
  features,
  data: rows,
  columns,
  state: { sorting, pagination, columnFilters, rowSelection },
  onRowSelectionChange,
  getRowId: (row) => toId(toTuple(row)),
  // …manual flags as above…
});
```

- **Only selected ids are listed.** TanStack Table v9's `RowSelectionState` is `Record<string, true>` — a deselected row's key is removed, never set to `false` — so the handler maps the remaining keys back to tuples.
- **Off-page rows survive paging.** `selected` keeps tuples for rows that are no longer on the current page, and the `byId` index re-emits them, so a selection spans pages the way the published clause does.
- **Replay is the same call.** `client.setSelectedValues(selected)` (or tuples restored from the URL) republishes a selection, and `rowSelection` follows from `selected` — there is no TanStack Table state to re-seed.
- **Equal re-publishes are free.** `selected` is patched only when its value changes, so the `useMemo` above recomputes only on a real selection change.

## The filter bridge

`useTanStackTableFilterBridge({ filters, set, columns })` is a thin translator: it maps TanStack Table `columnFilters` state onto [`FilterSpec`](../core/filter-set.md)s written into a [FilterSet](../core/filter-set.md). The set owns everything downstream — resolving each spec into Selection clauses, routing them to named targets, self-exclusion, external-clear detection, chip derivation, and persistence. `column.setFilterValue()` and ecosystem filter components work unmodified; the data layer only ever sees a Selection.

Per-column config maps a TanStack Table column id to `{ column?, clause, label?, target? }`:

- `column` defaults to the id (dotted paths are struct access: `related_phrase.phrase` → `"related_phrase"."phrase"`).
- `label` and `target` carry onto the spec (`spec.label`, `spec.target`) — a chip label and the FilterSet target name the clauses route to.
- `clause` is one of six kinds, each mapped onto a built-in FilterSet spec kind:

| Kind           | Filter value                | Spec kind            | Result                                                                    |
| -------------- | --------------------------- | -------------------- | ------------------------------------------------------------------------- |
| `'equals'`     | any value                   | `point`              | null-safe equality; explicit `null` matches SQL NULLs, `undefined` clears |
| `'ilike'`      | string                      | `match` (`contains`) | case-insensitive contains; empty string clears                            |
| `'prefix'`     | string                      | `match` (`prefix`)   | case-insensitive prefix; empty string clears                              |
| `'range'`      | `[lo, hi]` numbers          | `interval`           | `BETWEEN`; either bound may be open → plain `>=`/`<=`; both open clears   |
| `'date-range'` | `[lo, hi]` Dates or strings | `interval`           | like `'range'` with bounds coerced to `Date` literals                     |
| `'in'`         | array                       | `points`             | membership; a scalar becomes a one-element list, an empty array clears    |

Filters on column ids without a config entry are deliberately ignored — they are yours to route elsewhere (or not at all).

The managed spec id is `` `${idPrefix}${columnId}` `` (`idPrefix` defaults to `''`). Choose it so the ids are stable and unique across every writer into the same set — e.g. `idPrefix: 'detail:'` for a detail table sharing a page set.

### Spec lifecycle

The bridge diffs precisely, because every set write can re-query every consumer:

- **Stable identity** — the spec id is stable per column id: a changed filter value _replaces_ the spec (and, through the set, its clause), never accumulates.
- **Removal** — clearing a column filter removes exactly its spec; unmount (or a `set` identity change) removes every spec the bridge manages, unless you opt into [`retainSpecsOnUnmount`](#conditional-bridges-and-retaining-specs).
- **Echo suppression** — writes are value-diffed against the bridge's last-pushed spec. Re-renders with equal filter state (fresh array/object identities included) write nothing; the set adds its own SQL-level suppression on top, so store-update → re-render → bridge cycles cannot feed back into Selection activations.
- **No self-exclusion** — the bridge's specs carry no `clients` set, so the table _is_ filtered by its own column filters, even inside a `Selection.crossfilter()`. That is the point: column filters describe the table's contents.
- **Labels and targets** — `label`/`target` on the column config flow onto the spec, so a chip bar reading the set (`useFilterSetChips`) labels the filter and the set routes its clauses to the named target.

### External changes and hydration

Someone other than the table can change a managed spec — an active-filter chip bar's X, a global `set.reset()`, or persisted state hydrated into the set before the table mounts. The bridge watches the set's store (not Selection value events) and, when an id it manages disappears without the bridge removing it, reports the rebuilt TanStack Table state via `onExternalChange` so the consumer adopts it:

```tsx
useTanStackTableFilterBridge({
  filters: columnFilters,
  set: pageSet,
  idPrefix: 'detail:',
  columns: bridgeColumns,
  onExternalChange: (filters) => setColumnFilters(filters),
});
```

- **External removal** — the bridge inverts the surviving specs back to filter values and hands you the full state; you replace `columnFilters` with it, so cleared columns' inputs empty instead of republishing.
- **Hydration adoption** — at creation (or when `setColumns` first configures a column whose spec already exists in the set), such specs are _not_ cleared; the bridge inverts them and reports them through the same callback, so persisted state drives the table. Until your filter state confirms an adopted spec, the bridge protects it: reconciles against not-yet-updated state skip it, and unmount leaves it in the set — a StrictMode double-mount re-adopts cleanly with zero spec churn. Without the callback, such specs are left untouched (the bridge never silently clears state it did not publish).

Held by latest-ref — a new `onExternalChange` identity never recreates the bridge.

Framework-agnostic consumers can use the core directly: `createTanStackTableFilterBridge({ set, columns, idPrefix?, onExternalChange? })` with `setFilters` / `setColumns` / `destroy`. `destroy({ retainSpecs: true })` is the core form of `retainSpecsOnUnmount` below.

### Conditional bridges and retaining specs

Two options cover tables whose filters should not simply live and die with the component:

- **`set: undefined` makes the bridge inert.** No bridge exists, nothing is published or adopted, and `onExternalChange` never fires — so a bridge that only applies sometimes (no set yet, or a mode without column filtering) needs no wrapper component. Going from a set to `undefined` tears the bridge down exactly like an unmount; going back creates a fresh one that adopts whatever is in the set.
- **`retainSpecsOnUnmount: true` keeps the filters applied.** Teardown (unmount, a `set` or `idPrefix` change, or `set` becoming `undefined`) leaves every managed spec in the set instead of removing it. The default, `false`, keeps the behaviour described in [Spec lifecycle](#spec-lifecycle). The flag is read at teardown time, so flipping it in the same render that disables the bridge applies, and changing it never recreates the bridge.

```tsx
useTanStackTableFilterBridge({
  filters: columnFilters,
  set: filteringEnabled ? pageSet : undefined,
  columns: bridgeColumns,
  onExternalChange: setColumnFilters, // required to re-adopt retained specs
  retainSpecsOnUnmount: true,
});
```

Retained specs belong to nobody until a bridge adopts them, so two things are yours to handle:

- **Re-adoption needs `onExternalChange`.** A later bridge over the same set and managed ids adopts the retained specs and reports them through the callback, so the table's filter inputs show them and clearing them works. Without the callback the new bridge leaves pre-existing specs alone, and its own (possibly empty) filter state cannot clear them.
- **You own the eventual cleanup.** If no bridge comes back, remove the specs yourself — `set.remove(id)`, `set.reset()`, or a chip bar's X — or they keep filtering every consumer of the set.

### Atom-controlled filter state

v9's [recommended controlled-state pattern](https://tanstack.com/table/beta/docs/framework/react/guide/table-state#controlled-state) is external atoms: pass a writable atom via the table's `atoms` option and it takes ownership of that state slice (no `onColumnFiltersChange` needed). The bridge's contract is value-in/callback-out, so an atom-owned `columnFilters` slice drives it through a read-and-write-back adapter:

```tsx
import { useAtom, useCreateAtom } from '@tanstack/react-store';
import type { ColumnFiltersState } from '@tanstack/react-table';

const columnFiltersAtom = useCreateAtom<ColumnFiltersState>([]);
const [columnFilters, setColumnFilters] = useAtom(columnFiltersAtom);

const table = useTable({
  features,
  columns,
  data,
  manualFiltering: true,
  // The atom owns the slice — do not also pass state/onColumnFiltersChange.
  atoms: { columnFilters: columnFiltersAtom },
});

useTanStackTableFilterBridge({
  filters: columnFilters,
  set: pageSet,
  columns: bridgeColumns,
  onExternalChange: setColumnFilters,
});
```

This is a workaround for now, not the end state: `useAtom` subscribes the component to the atom, so every filter change round-trips through a React re-render solely to feed the bridge — the coupling the atom model exists to avoid. Built-in atom support (the bridge subscribing to the atom directly, with external changes written back without the callback) is not implemented; if you need it, [file an issue](https://github.com/nozzle/mosaic-adapters/issues).

## When not to use the bridge

The bridge exists for one case: you want TanStack Table's filter _state model_ (`columnFilters`, `column.setFilterValue()`, existing filter UI components) on a Mosaic-backed table. Everything else on the page should write into the same [FilterSet](../core/filter-set.md) directly:

- Top-bar text inputs, date pickers, facet menus, histogram brushes, and summary-row selections call `set.set(spec)` (or publish through `publish.into`) — no TanStack Table state in the loop, no bridge.
- The bridge's six clause kinds are deliberately simple, one spec per column. Composite predicates, OR groups, subquery/membership filters, and metric thresholds belong in [custom FilterSet kinds](../core/filter-set.md) built on the core clause factories and `subqueryFilterKind`.
- If your filter UI does not need to live in TanStack Table state, skip `manualFiltering`/`columnFilters` entirely and let the rows client's `filterBy` do the work.

Sorting and pagination are different: those translators are just data mapping with no lifecycle, and are always the right tool when the state lives in TanStack Table.
