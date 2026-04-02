# Filter Builder

The filter-builder API adds a schema layer on top of Mosaic `Selection` wiring.
Consumers define filters once, create page and widget scopes, bind native HTML
controls, and keep passing the resulting context into `filterBy`.

## Core Hooks

```tsx
import {
  useFilterBinding,
  useFilterFacet,
  useMosaicFilters,
} from '@nozzleio/mosaic-tanstack-react-table';
import { useComposedSelection } from '@nozzleio/react-mosaic';
```

### Define Filters

```ts
const pageDefinitions = [
  {
    id: 'status',
    label: 'Status',
    column: 'status',
    valueKind: 'facet-single',
    operators: ['is'],
    defaultOperator: 'is',
    facet: {
      table: 'tasks',
      sortMode: 'count',
    },
  },
  {
    id: 'created_at',
    label: 'Created',
    column: 'created_at',
    valueKind: 'date-range',
    operators: ['between', 'before', 'after'],
    defaultOperator: 'between',
    dataType: 'date',
  },
] as const;
```

### Create Scopes

```tsx
const page = useMosaicFilters({
  scopeId: 'page',
  definitions: pageDefinitions,
});

const widget = useMosaicFilters({
  scopeId: 'widget:w1',
  definitions: widgetDefinitions,
});

const widgetContext = useComposedSelection([page.context, widget.context]);
```

`page.context` affects every consumer that reads it. `widget.context` stays
local until you explicitly compose it with the page scope.

## Native HTML Controls

### Text Input

```tsx
function TextFilter({ filter }: { filter: FilterRuntime }) {
  const binding = useFilterBinding(filter);

  return (
    <input
      type="text"
      value={String(binding.value ?? '')}
      onChange={(event) => binding.setValue(event.target.value)}
      onBlur={binding.apply}
    />
  );
}
```

### Facet Select

```tsx
function StatusFilter({
  filter,
  filterBy,
}: {
  filter: FilterRuntime;
  filterBy?: Selection;
}) {
  const facet = useFilterFacet({ filter, filterBy, enabled: true });

  return (
    <select
      value={String(facet.selectedValues[0] ?? '')}
      onChange={(event) => facet.select(event.target.value || null)}
    >
      <option value="">All</option>
      {facet.options.map((option) => (
        <option key={String(option)} value={String(option ?? '')}>
          {String(option)}
        </option>
      ))}
    </select>
  );
}
```

### Date Range

```tsx
function DateRangeFilter({ filter }: { filter: FilterRuntime }) {
  const binding = useFilterBinding(filter);
  const value = (binding.value as [string | null, string | null] | null) ?? [
    null,
    null,
  ];

  return (
    <>
      <input
        type="date"
        value={value[0] ?? ''}
        onChange={(event) =>
          binding.setValue([event.target.value || null, value[1]])
        }
      />
      <input
        type="date"
        value={value[1] ?? ''}
        onChange={(event) =>
          binding.setValue([value[0], event.target.value || null])
        }
      />
      <button type="button" onClick={binding.apply}>
        Apply
      </button>
    </>
  );
}
```

## Topology Rule

Keep the topology explicit:

- page controls write into page selections
- widget controls write into widget selections
- tables and charts still consume a final `filterBy` selection

The trimmed example includes a dedicated `Filter Builder` view that shows:

- page-level native HTML controls
- a chart using `page.context`
- a page-scoped table
- a widget-local filter section and table using `page.context + widget.context`
