# Simple Usage

This guide walks through setting up a basic Mosaic-powered table in React. We'll build a chart + table view with shared filters, matching the "first principles" example in `examples/react/trimmed`.

## Prerequisites

Install the required packages:

```bash
pnpm add @nozzleio/mosaic-tanstack-react-table @nozzleio/react-mosaic @tanstack/react-table @uwdata/vgplot @uwdata/mosaic-core
```

## Basic Setup

### 1. Wrap Your App with Providers

The Mosaic adapter needs a coordinator context. The simplest setup uses the global vgplot coordinator:

```tsx
import * as vg from '@uwdata/vgplot';
import { MosaicContext } from '@nozzleio/react-mosaic';

function App() {
  return (
    <MosaicContext.Provider value={vg.coordinator()}>
      <MyTableView />
    </MosaicContext.Provider>
  );
}
```

### 2. Define Your Data Interface

TypeScript interfaces ensure type safety throughout:

```ts
interface AthleteRowData {
  id: number;
  name: string;
  nationality: string;
  sex: string;
  height: number | null;
  weight: number | null;
  sport: string | null;
}
```

### 3. Create Selections

Selections hold filter state. For a simple setup, you need two:

```ts
import * as vg from '@uwdata/vgplot';

// External inputs (menus, search boxes, chart brushes)
const $query = vg.Selection.intersect();

// Table column filters
const $tableFilter = vg.Selection.intersect();

// Combined context (chart filters by inputs + table filters)
const $combined = vg.Selection.intersect({
  include: [$query, $tableFilter],
});
```

### 4. Load Data into DuckDB

Before querying, load your data. This typically happens in a `useEffect`:

```tsx
import { useEffect, useState } from 'react';
import * as vg from '@uwdata/vgplot';

function MyTableView() {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    async function init() {
      await vg.coordinator().exec([
        `CREATE OR REPLACE TABLE athletes AS 
         SELECT * FROM 'https://example.com/athletes.parquet'`,
      ]);
      setIsReady(true);
    }
    init();
  }, []);

  if (!isReady) return <div>Loading...</div>;
  return <AthletesTable />;
}
```

### 5. Define Columns with SQL Metadata

You can configure SQL behavior directly in column definitions using `meta.mosaicDataTable`:

```tsx
import { useMemo } from 'react';
import type { ColumnDef } from '@tanstack/react-table';

function AthletesTable() {
  const columns = useMemo<ColumnDef<AthleteRowData, any>[]>(
    () => [
      {
        accessorKey: 'id',
        header: 'ID',
        meta: {
          mosaicDataTable: {
            sqlColumn: 'id',
            sqlFilterType: 'EQUALS',
          },
        },
      },
      {
        accessorKey: 'name',
        header: 'Name',
        meta: {
          filterVariant: 'text',
          mosaicDataTable: {
            sqlColumn: 'name',
            sqlFilterType: 'PARTIAL_ILIKE',
          },
        },
      },
      {
        accessorKey: 'nationality',
        header: 'Nationality',
        meta: {
          filterVariant: 'select',
          mosaicDataTable: {
            sqlColumn: 'nationality',
            sqlFilterType: 'EQUALS',
            facet: 'unique', // Populates dropdown with distinct values
          },
        },
      },
      {
        accessorKey: 'height',
        header: 'Height',
        cell: (props) => `${props.getValue()}m`,
        meta: {
          filterVariant: 'range',
          mosaicDataTable: {
            sqlColumn: 'height',
            sqlFilterType: 'RANGE',
            facet: 'minmax', // Gets min/max for slider bounds
          },
        },
      },
      {
        accessorKey: 'sport',
        header: 'Sport',
        meta: {
          filterVariant: 'select',
          mosaicDataTable: {
            sqlColumn: 'sport',
            sqlFilterType: 'EQUALS',
            facet: 'unique',
          },
        },
      },
    ],
    [],
  );

  // ... continue below
}
```

### 6. Use the Hook

The `useMosaicReactTable` hook connects everything:

```tsx
import { useReactTable } from '@tanstack/react-table';
import {
  useMosaicReactTable,
  coerceNumber,
} from '@nozzleio/mosaic-tanstack-react-table';

function AthletesTable() {
  const columns = useMemo(
    () => [
      /* ... */
    ],
    [],
  );

  const { tableOptions } = useMosaicReactTable<AthleteRowData>({
    table: 'athletes',
    filterBy: $query, // Inputs + chart brush
    tableFilterSelection: $tableFilter, // Where column filters write
    columns,
    converter: (row) => ({
      ...row,
      height: coerceNumber(row.height),
      weight: coerceNumber(row.weight),
    }),
    tableOptions: {
      enableSorting: true,
      enableColumnFilters: true,
    },
  });

  const table = useReactTable(tableOptions);

  return <MyTableRenderer table={table} />;
}
```

**Key options explained:**

- `table`: DuckDB table name or query factory
- `filterBy`: Selection providing external filter predicates
- `tableFilterSelection`: Selection where column filters are written
- `columns`: TanStack column definitions with `meta.mosaicDataTable`
- `converter`: Transform raw DB rows into typed app data (handles nulls, dates)

### 7. Render the Table

Use standard TanStack Table rendering:

```tsx
function MyTableRenderer({ table }) {
  return (
    <table>
      <thead>
        {table.getHeaderGroups().map((headerGroup) => (
          <tr key={headerGroup.id}>
            {headerGroup.headers.map((header) => (
              <th key={header.id}>
                {flexRender(
                  header.column.columnDef.header,
                  header.getContext(),
                )}
              </th>
            ))}
          </tr>
        ))}
      </thead>
      <tbody>
        {table.getRowModel().rows.map((row) => (
          <tr key={row.id}>
            {row.getVisibleCells().map((cell) => (
              <td key={cell.id}>
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

## Using a Mapping (Type-Safe Alternative)

For better type safety, use `createMosaicMapping` instead of inline metadata:

```ts
import {
  createMosaicMapping,
  createMosaicColumnHelper,
} from '@nozzleio/mosaic-tanstack-react-table';

const AthleteMapping = createMosaicMapping<AthleteRowData>({
  id: { sqlColumn: 'id', type: 'INTEGER', filterType: 'EQUALS' },
  name: { sqlColumn: 'name', type: 'VARCHAR', filterType: 'PARTIAL_ILIKE' },
  nationality: {
    sqlColumn: 'nationality',
    type: 'VARCHAR',
    filterType: 'EQUALS',
  },
  height: { sqlColumn: 'height', type: 'FLOAT', filterType: 'RANGE' },
  sport: { sqlColumn: 'sport', type: 'VARCHAR', filterType: 'EQUALS' },
});

// Use the column helper for type-safe column creation
const columnHelper = createMosaicColumnHelper<AthleteRowData>();

const columns = [
  columnHelper.accessor('id', { header: 'ID' }),
  columnHelper.accessor('name', { header: 'Name' }),
  columnHelper.accessor('height', {
    header: 'Height',
    cell: (props) => `${props.getValue()}m`,
  }),
];

// Pass mapping to the hook
const { tableOptions } = useMosaicReactTable({
  table: 'athletes',
  columns,
  mapping: AthleteMapping, // <-- Type-safe mapping
  // ...
});
```

**Benefits of mappings:**

- TypeScript enforces compatible filter types (can't use `RANGE` on a `VARCHAR`)
- Centralized SQL configuration, not scattered across columns
- Reusable across multiple components

## Adding External Inputs + Chart (Shared Context)

Connect vgplot inputs to your selection and render a chart that filters by `$combined`:

```tsx
useEffect(() => {
  const inputs = vg.hconcat(
    vg.menu({
      label: 'Sport',
      as: $query,
      from: 'athletes',
      column: 'sport',
    }),
    vg.menu({
      label: 'Gender',
      as: $query,
      from: 'athletes',
      column: 'sex',
    }),
    vg.search({
      label: 'Name',
      as: $query,
      from: 'athletes',
      column: 'name',
      type: 'contains',
    }),
  );

  const plot = vg.plot(
    vg.dot(vg.from('athletes', { filterBy: $combined }), {
      x: 'weight',
      y: 'height',
      fill: 'sex',
      r: 2,
      opacity: 0.05,
    }),
    vg.intervalXY({ as: $query }),
    vg.xyDomain(vg.Fixed),
    vg.colorDomain(vg.Fixed),
  );

  const layout = vg.vconcat(inputs, vg.vspace(10), plot);
  document.getElementById('chart')?.replaceChildren(layout);
}, []);
```

These inputs update `$query`. The chart filters by `$combined`, so chart and table stay in sync.

## Pagination

The adapter handles pagination automatically:

```tsx
const { tableOptions } = useMosaicReactTable({
  // ...
  tableOptions: {
    initialState: {
      pagination: { pageSize: 20 },
    },
  },
});
```

The hook manages `manualPagination` internally and fetches only the visible page from DuckDB.

## Debugging

Add a `__debugName` to get labeled logs in the console:

```ts
const { tableOptions } = useMosaicReactTable({
  table: 'athletes',
  columns,
  mapping: AthleteMapping,
  __debugName: 'AthletesTableSimple',
});
```

You can also import the logger:

```ts
import { logger } from '@nozzleio/mosaic-tanstack-react-table';
```

## Complete Example

See `examples/react/trimmed/src/components/views/athletes-simple.tsx` for a full working implementation using the "first principles" approach (inline metadata, no mapping helper).

## Next Steps

- [Dual-Mode Setup](./dual-mode-setup.md) – WASM + remote server execution
- [Complex Setup](./complex-setup.md) – Multi-table dashboards with cross-filtering
- [Inputs](./inputs.md) – Building custom filter inputs
- [Real-World Examples](./real-world-examples.md) – PAA and Athletes dashboards
- [Data Flow](../core/data-flow.md) – Understanding the query lifecycle
