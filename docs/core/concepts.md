# Core Concepts

This guide introduces the foundational concepts for building data-driven tables and dashboards with the Mosaic adapters.

## What is Mosaic?

[Mosaic](https://uwdata.github.io/mosaic/) is a framework for linking data visualizations, tables, and inputs through a shared query coordinator. It executes SQL queries against DuckDB (WASM or server) and propagates filter state across connected clients.

The **Mosaic adapters** in this repo extend Mosaic to work seamlessly with TanStack Table and React.

If you are building a React app, the primary library is `@nozzleio/mosaic-tanstack-react-table`. The `@nozzleio/react-mosaic` package provides React bindings around Mosaic primitives. See the package overview in [Package Map](./package-map.md).

**Packages you install:**

| Package                                 | Purpose                                                                 |
| --------------------------------------- | ----------------------------------------------------------------------- |
| `@nozzleio/mosaic-tanstack-table-core`  | Framework-agnostic core: query building, filter strategies, facet logic |
| `@nozzleio/mosaic-tanstack-react-table` | React bindings: hooks for tables, facets, filters, histograms           |
| `@nozzleio/react-mosaic`                | React primitives: coordinator context, selection helpers, registries    |

## Coordinator

The **Coordinator** is the central hub that:

1. Manages a connection to DuckDB (WASM, socket, or HTTP)
2. Receives SQL queries from clients
3. Caches and optimizes query execution
4. Notifies clients when upstream filters change

### Basic Setup (WASM only)

For simple apps using only browser-side DuckDB:

```tsx
import * as vg from '@uwdata/vgplot';
import { MosaicContext } from '@nozzleio/react-mosaic';

<MosaicContext.Provider value={vg.coordinator()}>
  {children}
</MosaicContext.Provider>;
```

### Dual-Mode Setup (WASM + Remote)

For apps that switch between local and remote execution:

```tsx
import {
  MosaicConnectorProvider,
  HttpArrowConnector,
} from '@nozzleio/react-mosaic';

<MosaicConnectorProvider
  initialMode="wasm"
  remoteConnectorFactory={() =>
    new HttpArrowConnector({ url: 'http://localhost:3001/query' })
  }
>
  {children}
</MosaicConnectorProvider>;
```

This provides `useConnectorStatus()` and `useMosaicCoordinator()` hooks for managing mode switching. See [Dual-Mode Setup](../react/dual-mode-setup.md) for details.

Hooks like `useCoordinator()` access the coordinator implicitly from context.

## Selection

A **Selection** represents a filter state that can be shared across multiple clients. Selections are the glue that enables cross-filtering.

```ts
import * as vg from '@uwdata/vgplot';

// Different resolution modes
const $intersect = vg.Selection.intersect(); // AND logic (most common)
const $union = vg.Selection.union(); // OR logic
const $single = vg.Selection.single(); // Last-writer-wins
const $crossfilter = vg.Selection.crossfilter(); // Exclude self from filter
```

When a user interacts with an input (dropdown, brush, search), the input **updates** the selection. All clients that **filter by** that selection automatically re-query.

### Derived Selections (Contexts)

You can compose selections to create **contexts**:

```ts
// Table sees filters from inputs + histograms, but not its own column filters
const $tableContext = vg.Selection.intersect({
  include: [$inputs, $histogramWeight, $histogramHeight],
});
```

This is the foundation of the **topology** pattern covered in [Data Flow](./data-flow.md).

## Mapping

A **Mapping** defines how TypeScript data keys correspond to SQL columns. It enforces type safety and controls filter behavior.

```ts
import { createMosaicMapping } from '@nozzleio/mosaic-tanstack-react-table';

interface AthleteRowData {
  id: number;
  name: string;
  height: number | null;
  date_of_birth: Date | null;
}

const AthleteMapping = createMosaicMapping<AthleteRowData>({
  id: { sqlColumn: 'id', type: 'INTEGER', filterType: 'EQUALS' },
  name: { sqlColumn: 'name', type: 'VARCHAR', filterType: 'PARTIAL_ILIKE' },
  height: { sqlColumn: 'height', type: 'FLOAT', filterType: 'RANGE' },
  date_of_birth: {
    sqlColumn: 'date_of_birth',
    type: 'DATE',
    filterType: 'DATE_RANGE',
  },
});
```

**Why use a mapping?**

- Type-safe: TypeScript ensures filter types match column types
- Explicit: All SQL behavior is declared upfront, not scattered in column defs
- Reusable: Share mappings across multiple tables querying the same schema

**Alternative: Column Metadata**

If you prefer inline configuration, define SQL behavior directly in `column.meta`:

```ts
{
  accessorKey: 'name',
  meta: {
    mosaicDataTable: {
      sqlColumn: 'name',
      sqlFilterType: 'PARTIAL_ILIKE',
    },
  },
}
```

This is more flexible but less type-safe. See [Simple Usage](../react/simple-usage.md) for a full example.

## Filter Types

The adapter supports several filter strategies out of the box:

| Filter Type     | Use Case                  | Example                      |
| --------------- | ------------------------- | ---------------------------- |
| `EQUALS`        | Exact match               | `id = 5`                     |
| `ILIKE`         | Case-insensitive match    | `name ILIKE 'john'`          |
| `PARTIAL_ILIKE` | Case-insensitive contains | `name ILIKE '%john%'`        |
| `RANGE`         | Numeric range             | `height BETWEEN 1.5 AND 2.0` |
| `DATE_RANGE`    | Date/timestamp range      | `date >= '2020-01-01'`       |
| `MATCH`         | Boolean/enum match        | `active = true`              |
| `SELECT`        | Dropdown selection        | `sport = 'Swimming'`         |

Custom strategies can be registered via `filterStrategies` option.

## Facets

A **Facet** is metadata about a column's values, used to populate dropdowns or determine slider bounds.

| Facet Type | Returns                  | Use Case            |
| ---------- | ------------------------ | ------------------- |
| `unique`   | Distinct values + counts | Dropdown options    |
| `minmax`   | Min and max values       | Slider/range bounds |

Facets are configured per-column:

```ts
{
  accessorKey: 'sport',
  meta: {
    filterVariant: 'select',
    mosaicDataTable: { facet: 'unique' },
  },
}
```

The adapter automatically queries facet data and keeps it in sync with active filters.

## Registries

Registries provide centralized state management for selections and filters.

### Selection Registry

Tracks active selections for **global reset** functionality:

```tsx
import {
  SelectionRegistryProvider,
  useRegisterSelections,
} from '@nozzleio/react-mosaic';

// Wrap your app
<SelectionRegistryProvider>
  <App />
</SelectionRegistryProvider>;

// In a view component
useRegisterSelections([$inputs, $tableFilter, $histogramWeight]);
```

Calling `resetAll()` clears all registered selections at once.

### Filter Registry

Tracks active filter state for **active filter bar** UI (showing chips/badges of current filters):

```tsx
import {
  MosaicFilterProvider,
  useRegisterFilterSource,
} from '@nozzleio/react-mosaic';

<MosaicFilterProvider>
  <App />
</MosaicFilterProvider>;

// Register a selection with a label
useRegisterFilterSource($domainFilter, 'global', {
  labelMap: { domain: 'Domain' },
});
```

## Glossary

| Term          | Definition                                                         |
| ------------- | ------------------------------------------------------------------ |
| **Client**    | Any entity that queries the coordinator (table, chart, facet menu) |
| **Predicate** | SQL WHERE clause fragment generated from a selection               |
| **Topology**  | The wiring of selections and contexts in a dashboard               |
| **Sidecar**   | Auxiliary query client for facets, histograms, etc.                |
| **Converter** | Function to transform raw DB rows into typed app data              |

## Next Steps

- [Package Map](./package-map.md) – Which package to use and why
- [Data Flow](./data-flow.md) – How queries and filters propagate
- [Simple Usage](../react/simple-usage.md) – Minimal React table setup
- [Dual-Mode Setup](../react/dual-mode-setup.md) – WASM + remote execution
- [Complex Setup](../react/complex-setup.md) – Multi-table topologies
- [Inputs](../react/inputs.md) – Filter inputs and facet menus
