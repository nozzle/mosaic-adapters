# Inputs

This guide covers building filter inputs that connect to Mosaic selections. You'll learn to create dropdowns, search boxes, date pickers, and histograms that cross-filter your dashboard.

## Overview

The adapter provides three main hooks for inputs:

| Hook                      | Purpose                                    |
| ------------------------- | ------------------------------------------ |
| `useMosaicTableFacetMenu` | Dropdown/multi-select with dynamic options |
| `useMosaicTableFilter`    | Text input, date range, numeric range      |
| `useMosaicHistogram`      | Histogram data for brushable charts        |

All inputs follow the same pattern:

1. **Write** to a selection (updates filter state)
2. **Read** from a context (optional, for dynamic options)

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
            <li onClick={() => toggle(null)}>
              All {selectedValues.length === 0 && '✓'}
            </li>
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

The hook supports multi-select by default. For single-select:

```tsx
const handleSelect = (value: string | null) => {
  // Clear all first, then select new value
  toggle(null);
  if (value) toggle(value);
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
| `CONDITION`  | Complex object                     | Custom operator-based filter |

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
import { useMosaicHistogram } from '@nozzleio/mosaic-tanstack-react-table';
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
  const { bins, stats } = useMosaicHistogram({
    table,
    column,
    step,
    filterBy,
  });

  // bins: Array<{ x0: number, x1: number, count: number }>
  // stats: { maxCount: number, totalCount: number }

  return (
    <div className="histogram">
      <svg width={200} height={60}>
        {bins.map((bin, i) => (
          <rect
            key={i}
            x={i * 10}
            y={60 - (bin.count / stats.maxCount) * 60}
            width={8}
            height={(bin.count / stats.maxCount) * 60}
            fill="steelblue"
          />
        ))}
      </svg>
      {/* Add brush interaction here */}
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
