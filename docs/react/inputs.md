# Inputs

This guide covers building filter inputs that connect to Mosaic selections. You'll learn to create dropdowns, search boxes, date pickers, and histograms that cross-filter your dashboard.

## Overview

The adapter provides these main hooks for inputs:

| Hook                      | Purpose                                                                    |
| ------------------------- | -------------------------------------------------------------------------- |
| `useMosaicTextInput`      | Headless text input backed by Param or Selection output                    |
| `useMosaicSelectInput`    | Headless single-select or multi-select backed by Param or Selection output |
| `useMosaicTableFacetMenu` | Dropdown/multi-select with dynamic options                                 |
| `useMosaicTableFilter`    | Text input, date range, numeric range                                      |
| `useMosaicHistogram`      | Histogram data for brushable charts                                        |

For schema-driven builder UIs, use the filter-builder hooks instead:

| Hook               | Purpose                                                       |
| ------------------ | ------------------------------------------------------------- |
| `useMosaicFilters` | Create page or widget filter scopes backed by `Selection`s    |
| `useFilterBinding` | Bind text, date, and number inputs without raw predicate code |
| `useFilterFacet`   | Resolve facet options for builder-defined facet filters       |

See [Filter Builder](./filter-builder.md) for the page-scope/widget-scope
pattern, native HTML examples, and the trimmed dynamic builder example that
adds and removes active filter rows from a catalog.

The builder hooks also accept optional synchronous persisters:

- `useMosaicFilters({ persister })` persists a sparse scope snapshot
- `useFilterBinding(filter, { persister })` persists an individual binding

Selection state remains authoritative. On mount, builder bindings hydrate from
the committed `Selection` first and only fall back to persister reads when the
current selection has no valid committed value.

When using `FilterDefinition.operators`, prefer the exported condition helper
objects from `@nozzleio/mosaic-tanstack-react-table`, for example:

- `TEXT_CONDITIONS`
- `SELECT_CONDITIONS`
- `MULTISELECT_SCALAR_CONDITIONS`
- `MULTISELECT_ARRAY_CONDITIONS`
- `DATE_CONDITIONS`
- `DATE_RANGE_CONDITIONS`
- `NUMBER_CONDITIONS`
- `NUMBER_RANGE_CONDITIONS`

Raw string ids still work for compatibility, but the helper exports are the
canonical public registry of package-supported conditions.

All inputs follow the same pattern:

1. **Write** to a selection (updates filter state)
2. **Read** from a context (optional, for dynamic options)

## Headless Text and Select Inputs

Use the `/inputs` sub-export for Mosaic-aware controls that manage their own
Mosaic client while leaving rendering up to React.

```tsx
import {
  useMosaicSelectInput,
  useMosaicTextInput,
} from '@nozzleio/mosaic-tanstack-react-table/inputs';
```

`MosaicTextInput` and `MosaicSelect` are also exported as minimal native
wrappers, but most apps should wire the hooks into their own design-system
controls.

The framework-agnostic core lives at
`@nozzleio/mosaic-tanstack-table-core/input-core` for non-React adapters.

### Output: `as`

Both inputs accept `as: Param | Selection`.

| Target      | Behavior                                                                |
| ----------- | ----------------------------------------------------------------------- |
| `Param`     | Writes the raw value, selected array, or `null` without a SQL predicate |
| `Selection` | Publishes a Mosaic clause with `source` set to the input client         |

Empty text, an empty multi-select array, and the synthetic All value clear the
input's active predicate by writing a clause with `predicate: null`.

### Text Input

`useMosaicTextInput` exposes state plus `setValue`, `activate`, `clear`, and the
underlying client.

```tsx
import * as vg from '@uwdata/vgplot';
import { useMosaicTextInput } from '@nozzleio/mosaic-tanstack-react-table/inputs';

const $query = vg.Selection.intersect();

function NameSearch() {
  const name = useMosaicTextInput({
    as: $query,
    from: 'athletes',
    column: 'name',
    field: 'name',
    match: 'contains',
  });

  return (
    <input
      value={name.value}
      onChange={(event) => name.setValue(event.currentTarget.value)}
      onFocus={(event) => name.activate(event.currentTarget.value)}
      placeholder="Search names"
    />
  );
}
```

When `from` and `column` are provided, the text client queries distinct
suggestions into `suggestions`. `from` can be a string table name or a
`Param<string>`; Param changes re-query the suggestions. `filterBy` applies
dashboard context to the suggestion query.

`match` controls the Selection predicate and supports `contains`, `prefix`,
`suffix`, and `regexp`. `field` overrides the predicate field; otherwise the
input uses `column`.

### Select Input

`useMosaicSelectInput` exposes `value`, normalized `options`, `pending`,
`error`, `setValue`, `activate`, `clear`, and the underlying client.

```tsx
import { useMosaicSelectInput } from '@nozzleio/mosaic-tanstack-react-table/inputs';

function SportSelect() {
  const sport = useMosaicSelectInput<string>({
    as: $query,
    from: 'athletes',
    column: 'sport',
    field: 'sport',
    filterBy: $tableContext,
  });

  const selectedIndex = sport.options.findIndex((option) =>
    Object.is(option.value, sport.value),
  );

  return (
    <select
      value={selectedIndex < 0 ? '' : String(selectedIndex)}
      onChange={(event) => {
        const option = sport.options[Number(event.currentTarget.value)];
        sport.setValue(option?.value ?? null);
      }}
    >
      {sport.options.map((option, index) => (
        <option key={index} value={String(index)}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
```

Select options can be literal:

```tsx
const control = useMosaicSelectInput({
  as: sportParam,
  options: [
    { value: 1, label: 'One' },
    { value: 2, label: 'Two' },
  ],
});
```

Or query-backed with `from` and `column`. Query-backed single-select inputs
include an All option by default. Literal options and multi-select inputs only
include All when `includeAll` is true.

### Multi-Select and List Columns

Pass `multiple: true` to store an array of selected original option values.

```tsx
const keywordGroups = useMosaicSelectInput({
  as: $query,
  from: 'pages',
  column: 'keyword_groups',
  field: 'keyword_groups',
  multiple: true,
  listMatch: 'any',
});
```

For Param output, non-empty multi-selects write the selected array and empty
arrays write `null`. For Selection output, scalar columns use an `IN` predicate.
List-valued columns use `list_has_any` for `listMatch="any"` and
`list_has_all` for `listMatch="all"`.

### Native Select Values

When wiring a native `<select>` yourself, use option indexes or another stable
local key for DOM `<option>` values, then map the selected DOM value back to
`control.options[index].value`. This preserves original number, boolean, Date,
object, or string values before calling `setValue`.

## Facet Menu (Dropdown)

Use `useMosaicTableFacetMenu` for select inputs that show distinct values from the database.

```tsx
import { useState } from 'react';
import { useMosaicTableFacetMenu } from '@nozzleio/mosaic-tanstack-react-table';
import type { Selection } from '@uwdata/mosaic-core';

interface SelectFilterProps {
  label: string;
  table: string;
  column: string;
  selection: Selection; // Where to write filter state
  filterBy?: Selection; // Context for dynamic options
}

function SelectFilter({
  label,
  table,
  column,
  selection,
  filterBy,
}: SelectFilterProps) {
  const [isOpen, setIsOpen] = useState(false);

  const {
    clear, // Clear all values
    displayOptions, // Current option list
    selectedValues, // Currently selected values
    loading, // Loading state
    toggle, // Toggle a value on/off
    setSearchTerm, // For typeahead filtering
    hasMore, // Pagination available
    loadMore, // Load next page
  } = useMosaicTableFacetMenu({
    table,
    column,
    selection,
    filterBy,
    limit: 50,
    sortMode: 'count', // 'count' or 'alpha'
    enabled: isOpen, // Only query when open
  });

  return (
    <div>
      <label>{label}</label>
      <button onClick={() => setIsOpen(!isOpen)}>
        {selectedValues.length === 0
          ? 'All'
          : `${selectedValues.length} selected`}
      </button>

      {isOpen && (
        <div className="dropdown">
          <input
            placeholder="Search..."
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <ul>
            <li onClick={clear}>All {selectedValues.length === 0 && '✓'}</li>
            {displayOptions.map((opt) => (
              <li key={String(opt)} onClick={() => toggle(String(opt))}>
                {String(opt)}
                {selectedValues.includes(opt) && ' ✓'}
              </li>
            ))}
          </ul>
          {hasMore && <button onClick={loadMore}>Load more</button>}
        </div>
      )}
    </div>
  );
}
```

### Key Options

| Option              | Type                  | Description                                    |
| ------------------- | --------------------- | ---------------------------------------------- |
| `table`             | `string`              | DuckDB table name                              |
| `column`            | `string`              | Column to get distinct values from             |
| `selection`         | `Selection`           | Where filter predicates are written            |
| `filterBy`          | `Selection`           | Context for filtering options (peer cascading) |
| `additionalContext` | `Selection`           | Extra context (e.g., detail table filters)     |
| `limit`             | `number`              | Max options per page (default 100)             |
| `sortMode`          | `'count' \| 'alpha'`  | Sort by frequency or alphabetically            |
| `enabled`           | `boolean`             | Suppress queries when false                    |
| `columnType`        | `'scalar' \| 'array'` | Handle array columns (e.g., tags)              |

### Multi-Select vs Single-Select

The hook supports multi-select by default. For single-select, use the built-in `select()` helper:

```tsx
const { select, clear } = useMosaicTableFacetMenu({
  // ...
});

const handleSelect = (value: string | null) => {
  if (value === null) {
    clear();
    return;
  }

  select(value);
};
```

### Array Columns

For columns containing arrays (e.g., `tags VARCHAR[]`):

```tsx
useMosaicTableFacetMenu({
  // ...
  columnType: 'array', // Unnests array values
  sortMode: 'alpha',
});
```

## Text Filter

Use `useMosaicTableFilter` for free-text search:

```tsx
import { useState, useEffect } from 'react';
import { useMosaicTableFilter } from '@nozzleio/mosaic-tanstack-react-table';
import type { Selection } from '@uwdata/mosaic-core';

interface TextFilterProps {
  label: string;
  column: string;
  selection: Selection;
}

function TextFilter({ label, column, selection }: TextFilterProps) {
  const filter = useMosaicTableFilter({
    selection,
    column,
    mode: 'TEXT',
    debounceTime: 300, // Debounce input
  });

  const [value, setValue] = useState('');

  // Sync with external resets
  useEffect(() => {
    const handleReset = () => {
      const v = selection.value;
      if (!v || (Array.isArray(v) && v.length === 0)) {
        setValue('');
      }
    };
    selection.addEventListener('value', handleReset);
    return () => selection.removeEventListener('value', handleReset);
  }, [selection]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setValue(newValue);
    filter.setValue(newValue);
  };

  return (
    <div>
      <label>{label}</label>
      <input
        type="text"
        value={value}
        onChange={handleChange}
        placeholder="Search..."
      />
    </div>
  );
}
```

### Filter Modes

| Mode         | Input Type                         | SQL Generated                |
| ------------ | ---------------------------------- | ---------------------------- |
| `TEXT`       | `string`                           | `column ILIKE '%value%'`     |
| `MATCH`      | `string \| number \| boolean`      | `column = value`             |
| `RANGE`      | `[number \| null, number \| null]` | `column BETWEEN min AND max` |
| `DATE_RANGE` | `[string \| null, string \| null]` | Date range comparison        |
| `SELECT`     | `string \| number \| boolean`      | `column = value`             |

## Date Range Filter

```tsx
import { useState, useEffect } from 'react';
import { useMosaicTableFilter } from '@nozzleio/mosaic-tanstack-react-table';

function DateRangeFilter({ label, column, selection }) {
  const filter = useMosaicTableFilter({
    selection,
    column,
    mode: 'DATE_RANGE',
  });

  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

  // Sync with external resets
  useEffect(() => {
    const handleReset = () => {
      const v = selection.value;
      if (!v || (Array.isArray(v) && v.length === 0)) {
        setStart('');
        setEnd('');
      }
    };
    selection.addEventListener('value', handleReset);
    return () => selection.removeEventListener('value', handleReset);
  }, [selection]);

  useEffect(() => {
    filter.setValue([start || null, end || null]);
  }, [start, end, filter]);

  return (
    <div>
      <label>{label}</label>
      <input
        type="date"
        value={start}
        onChange={(e) => setStart(e.target.value)}
      />
      <span>to</span>
      <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
    </div>
  );
}
```

## Histogram

Use `useMosaicHistogram` to get binned data for brushable histogram charts:

```tsx
import {
  useMosaicHistogram,
  useMosaicTableFilter,
} from '@nozzleio/mosaic-tanstack-react-table';
import { HistogramController } from '@nozzleio/mosaic-tanstack-react-table/controllers';
import type { Selection } from '@uwdata/mosaic-core';

interface HistogramProps {
  table: string;
  column: string;
  step: number; // Bin width
  selection: Selection; // Where brush writes
  filterBy?: Selection; // External context
}

function HistogramFilter({
  table,
  column,
  step,
  selection,
  filterBy,
}: HistogramProps) {
  const { bins, stats, loading, error } = useMosaicHistogram({
    table,
    column,
    step,
    filterBy,
  });

  const controller = new HistogramController(
    useMosaicTableFilter({ selection, column, mode: 'RANGE' }),
  );

  // bins: Array<{ bin: number, count: number }>
  // stats: { maxCount: number, totalCount: number }
  // loading: true while a query is in flight
  // error: the last query error, if any

  return (
    <div className="histogram">
      {error ? <div>{error.message}</div> : null}
      <svg width={200} height={60}>
        {bins.map((bin, i) => (
          <rect
            key={i}
            x={i * 10}
            y={60 - (bin.count / Math.max(stats.maxCount, 1)) * 60}
            width={8}
            height={(bin.count / Math.max(stats.maxCount, 1)) * 60}
            fill="steelblue"
            onClick={() =>
              controller.handleBinClick(
                bin.bin,
                bin.bin + step,
                selection.value as [number, number] | null,
              )
            }
          />
        ))}
      </svg>
      {loading ? <div>Loading…</div> : null}
    </div>
  );
}
```

### Integrating with vgplot

For full brush interaction, use vgplot's `intervalX`:

```tsx
import * as vg from '@uwdata/vgplot';
import { useEffect, useRef } from 'react';

function VgHistogram({ table, column, step, selection, filterBy }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;

    const plot = vg.plot(
      vg.rectY(vg.from(table, { filterBy }), {
        x: vg.bin(column, { step }),
        y: vg.count(),
        fill: 'steelblue',
        inset: 0.5,
      }),
      vg.intervalX({ as: selection }),
      vg.width(200),
      vg.height(60),
    );

    ref.current.replaceChildren(plot);
  }, [table, column, step, selection, filterBy]);

  return <div ref={ref} />;
}
```

## Peer Cascading

When multiple dropdowns filter each other, use `useCascadingContexts` to prevent the "ghost option" bug:

```tsx
import {
  useMosaicSelections,
  useCascadingContexts,
} from '@nozzleio/react-mosaic';

function FilterBar() {
  // Create selections for each input
  const inputs = useMosaicSelections(['domain', 'device', 'status']);

  // Each context includes all OTHER inputs
  const contexts = useCascadingContexts(inputs);

  return (
    <>
      <SelectFilter
        label="Domain"
        column="domain"
        selection={inputs.domain}
        filterBy={contexts.domain} // Sees device + status
      />
      <SelectFilter
        label="Device"
        column="device"
        selection={inputs.device}
        filterBy={contexts.device} // Sees domain + status
      />
      <SelectFilter
        label="Status"
        column="status"
        selection={inputs.status}
        filterBy={contexts.status} // Sees domain + device
      />
    </>
  );
}
```

**Why this matters:**

Without cascading, if you select "Mobile" in Device, the Device dropdown's options would filter to only show "Mobile" (because it's filtering by itself). With cascading, each dropdown sees all options that are valid given the _other_ filters.

## Syncing with Global Reset

Inputs should clear their local state when the selection is reset externally:

```tsx
useEffect(() => {
  const handleReset = () => {
    const v = selection.value;
    const isEmpty = !v || (Array.isArray(v) && v.length === 0);
    if (isEmpty) {
      setLocalValue(''); // Clear local input state
    }
  };

  selection.addEventListener('value', handleReset);
  return () => selection.removeEventListener('value', handleReset);
}, [selection]);
```

## Shadcn-Style Filters (Real App Pattern)

The PAA example uses shadcn UI wrappers for dropdowns and input controls, while still using the same core hooks. The pattern is:

1. `useMosaicTableFacetMenu` for select inputs
2. `useMosaicTableFilter` for text/date/range
3. Local open/search state managed in React
4. Clear local state on external resets

See `examples/react/trimmed/src/components/paa/paa-filters.tsx` for production-style inputs.

## Array Facets

Array columns (e.g., `tags VARCHAR[]`) must set `columnType: 'array'`:

```tsx
useMosaicTableFacetMenu({
  table,
  column: 'tags',
  selection,
  filterBy,
  columnType: 'array',
  sortMode: 'alpha',
});
```

See `examples/react/trimmed/src/components/paa/paa-filters.tsx` (`ArraySelectFilter`) for a full version.

## Histogram (Controller Pattern)

The `HistogramController` encapsulates click-to-toggle logic. This removes boilerplate and keeps the histogram view simple:

```tsx
import { HistogramController } from '@nozzleio/mosaic-tanstack-react-table/controllers';

const filter = useMosaicTableFilter({ selection, column, mode: 'RANGE' });
const controller = new HistogramController(filter);

const handleBinClick = (start: number, end: number) => {
  controller.handleBinClick(start, end, selectionValue ?? null);
};
```

See `examples/react/trimmed/src/components/histogram-filter.tsx` for the full implementation.

## Selection Value Sync

For components that need the current selection value, use `useMosaicSelectionValue` from `@nozzleio/react-mosaic`:

```tsx
const selectionValue = useMosaicSelectionValue<[number, number]>(selection);
```

This avoids manual event listeners and keeps the UI in sync with global resets.

If a component needs the value for one specific Mosaic client instead of the shared selection snapshot, pass a `source` option:

```tsx
const scopedValue = useMosaicSelectionValue<string[]>(selection, {
  source: client,
});
```

This reads `selection.valueFor(client)` and normalizes missing values to `null`, which is useful for client-local UI such as summary-card selection strips.

## Row Selection (Summary Tables)

Summary tables often act as filters. Use `rowSelection` to write a selection based on row clicks:

```ts
const { tableOptions } = useMosaicReactTable<GroupByRow>({
  table: queryFactory,
  filterBy: summaryContext,
  rowSelection: {
    selection: $summarySelection,
    column: 'key',
    columnType: 'scalar',
  },
  tableOptions: {
    enableRowSelection: true,
    enableMultiRowSelection: true,
  },
});
```

See `examples/react/trimmed/src/components/views/nozzle-paa.tsx` for the full summary table pattern.

If you surface summary selections in an active-filter bar, register the selection with `explodeArrayValues: true` so multi-select row picks render as separate removable chips instead of one combined value:

```tsx
useRegisterFilterSource($summarySelection, 'summary', {
  labelMap: { key: 'Selected Keyword' },
  explodeArrayValues: true,
});
```

## Complete Examples

- **Searchable select**: `examples/react/trimmed/src/components/paa/paa-filters.tsx` (`SearchableSelectFilter`)
- **Array select**: `examples/react/trimmed/src/components/paa/paa-filters.tsx` (`ArraySelectFilter`)
- **Text filter**: `examples/react/trimmed/src/components/paa/paa-filters.tsx` (`TextFilter`)
- **Date range**: `examples/react/trimmed/src/components/paa/paa-filters.tsx` (`DateRangeFilter`)
- **Histogram**: `examples/react/trimmed/src/components/histogram-filter.tsx`

## Next Steps

- [Complex Setup](./complex-setup.md) – Multi-table dashboard patterns
- [Real-World Examples](./real-world-examples.md) – PAA and Athletes dashboards
- [Data Flow](../core/data-flow.md) – How inputs propagate to queries
- [Concepts](../core/concepts.md) – Review selections and contexts
