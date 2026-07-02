# `@nozzleio/mosaic-core`

Framework-agnostic reactive data clients for [Mosaic](https://idl.uw.edu/mosaic/) coordinators.

A data client wraps upstream `makeClient`: a SQL query factory plus native Selections/Params in, a reactive typed store out. Tables, charts, KPI cards, and filter chips are thin renderers of client output.

Most apps install a framework package instead (e.g. `@nozzleio/react-mosaic`), which re-exports this package's public API. Install this package directly only for non-React frameworks or vanilla usage.

## Install

```bash
npm install @nozzleio/mosaic-core @uwdata/mosaic-core @uwdata/mosaic-sql
```

## What lives here

- `createRowsClient` — paginated/sorted rows with `filterBy` (WHERE) / `havingBy` (HAVING) Selections, `rowCount` totals, row-selection/hover clause publishing, and page prefetch
- `createValuesClient` — single-row aggregate query → typed record (N KPI cards, one round trip)
- `createValueClause`, `createSubqueryClause`, `createClearClause` — shared Selection clause construction
- `routeFilter`, `applyRoutedFilters` — WHERE/HAVING predicate routing at the SQL edge
- The full type contract: `DataClient`, `QuerySource`, `RowsInputs`, ...

```ts
import { createRowsClient } from '@nozzleio/mosaic-core';
import { Selection } from '@uwdata/mosaic-core';
import { Query } from '@uwdata/mosaic-sql';

const $page = Selection.crossfilter();

const athletes = createRowsClient({
  coordinator,
  query: ({ where }) =>
    Query.from('athletes').select('id', 'name', 'sport').where(where),
  filterBy: $page,
  inputs: { orderBy: [{ column: 'name' }], limit: 25, offset: 0 },
  rowCount: 'window',
});

athletes.store.subscribe(() => {
  const { rows, totalRows, status } = athletes.store.state;
  // render
});

athletes.setInputs({ offset: 25 }); // value-diffed; exactly one re-query
```

See `docs/core/` in the repository for concepts and the full client reference.
