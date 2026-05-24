# Filter Builder

The filter-builder API adds a schema layer on top of Mosaic `Selection` wiring.
Consumers define filters once, create page and widget scopes, bind native HTML
controls, and keep passing the resulting context into `filterBy`.

Package ownership is split deliberately:

- `@nozzleio/mosaic-tanstack-table-core/filter-builder` owns the filter schema and headless runtime.
- `@nozzleio/mosaic-tanstack-react-table` owns `useMosaicFilters`, `useFilterBinding`, `useFilterFacet`, and the React-specific topology integration.

## Core Hooks

```tsx
import {
  DATE_RANGE_CONDITIONS,
  SELECT_CONDITIONS,
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
    operators: [SELECT_CONDITIONS.IS],
    defaultOperator: SELECT_CONDITIONS.IS,
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
    operators: [
      DATE_RANGE_CONDITIONS.BETWEEN,
      DATE_RANGE_CONDITIONS.BEFORE,
      DATE_RANGE_CONDITIONS.AFTER,
    ],
    defaultOperator: DATE_RANGE_CONDITIONS.BETWEEN,
    dataType: 'date',
  },
] as const;
```

Raw string ids like `'is'` and `'between'` still work, but the exported
condition objects are the preferred source of truth for consumer code.

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

### Persistence Hooks

Both filter-builder hooks accept optional synchronous persisters:

```tsx
const page = useMosaicFilters({
  scopeId: 'page',
  definitions: pageDefinitions,
  persister: scopePersister,
});

const binding = useFilterBinding(filter, {
  persister: bindingPersister,
});
```

Hydration order is always:

- current committed `Selection` state
- binding persister
- scope persister

Persisted reads commit back into the underlying `Selection`, so bindings,
facets, and composed contexts all stay aligned on the same committed source of
truth. Draft-only updates from `setValue`, `setValueTo`, and `setOperator` do
not invoke persister writes. Writes happen only for committed changes from
`apply()`, `clear()`, or external `selection.update(...)` calls.

For headless integrations outside React, use the core helpers instead of
reading raw clauses directly:

```ts
import {
  applyFilterSelection,
  clearFilterSelection,
  readFilterSelectionState,
} from '@nozzleio/mosaic-tanstack-table-core/filter-builder';
```

This keeps clause shape and filter-builder source identity internal to the
package.

## Dynamic Builder Pattern

The trimmed React example now uses the same hooks to drive a primitive dynamic
builder instead of a hardcoded filter form.

Keep the active filter list in example-local UI state:

```tsx
const [pageActiveFilterIds, setPageActiveFilterIds] = useState([
  'name',
  'sport',
]);
const [widgetActiveFilterIds, setWidgetActiveFilterIds] = useState(['sex']);
```

Then render rows by resolving runtimes from the scope:

```tsx
{
  pageActiveFilterIds.map((id) => {
    const filter = page.getFilter(id);
    if (!filter) {
      return null;
    }

    return (
      <ActiveFilterRow
        key={id}
        filter={filter}
        filterBy={pageFacetContexts[id]}
        onRemoveFilter={(filterId) => {
          setPageActiveFilterIds((ids) => removeFilter(ids, filterId));
        }}
      />
    );
  });
}
```

This first pass intentionally keeps one active instance per filter
**definition id** per scope. `useMosaicFilters` creates one `Selection` for
each `definition.id`, so the example hides already-active definitions from the
Add Filter menu. Note this is keyed by `id`, not by `column` — see
[Multiple Definitions Per Column](#multiple-definitions-per-column) for the
intended pattern when several controls target the same SQL column.

Keep scope topology explicit:

- page rows write into page selections
- widget rows write into widget selections
- page consumers read `page.context`
- widget consumers read `useComposedSelection([page.context, widget.context])`

When removing a row, clear the selection first and then remove the id from the
local active list so UI state and Mosaic state stay in sync:

```tsx
binding.clear();
setPageActiveFilterIds((ids) => removeFilter(ids, filter.definition.id));
```

## Multiple Definitions Per Column

A `FilterDefinition` is a user-facing filter control, not a SQL column. The
runtime identity is `definition.id`; `definition.column` is just the SQL
target. Two definitions can point at the same column.

### Mental Model

```text
FilterDefinition + UI state
  -> FilterBindingState
  -> SelectionClause { value, predicate }
  -> selection.predicate(client)
  -> SQL WHERE clause
```

`useMosaicFilters` creates one `Selection` per `definition.id` and composes
them into a scope context with `Selection.intersect()`. If two definitions
target the same column, the scope context AND-s their predicates together.

### Example

```ts
const pageDefinitions = [
  {
    id: 'date_of_birth_after',
    label: 'Born after',
    column: 'date_of_birth',
    valueKind: 'date-range',
    operators: [DATE_RANGE_CONDITIONS.AFTER],
    defaultOperator: DATE_RANGE_CONDITIONS.AFTER,
    dataType: 'date',
  },
  {
    id: 'date_of_birth_before',
    label: 'Born before',
    column: 'date_of_birth',
    valueKind: 'date-range',
    operators: [DATE_RANGE_CONDITIONS.BEFORE],
    defaultOperator: DATE_RANGE_CONDITIONS.BEFORE,
    dataType: 'date',
  },
] as const;
```

With both active, the table query receives:

```sql
WHERE date_of_birth > '1990-01-01'
  AND date_of_birth < '2000-01-01'
```

### When To Split, When To Couple

- **Split into multiple definitions** when each control is independent in the
  UI and the user adds/removes them separately. Distinct ids, shared column.
- **Use one definition** when the state naturally couples — e.g. a range
  filter with `valueKind: 'number-range'` already carries `value` and
  `valueTo` in one binding.

Contradictory predicates on the same column (e.g. `> 100 AND < 10`) are valid
SQL — they just produce empty result sets. The runtime does not de-duplicate
or reconcile predicates across definitions.

### OR Semantics

The filter-builder runtime always composes definitions with `AND`
(`Selection.intersect()` inside `useMosaicFilters`). There is no first-class
OR mode today. Two escape hatches:

**A. Compound predicate inside one definition.** Bake the OR into a single
clause via `mSql.or(...)` so it lives in one `Selection`. Useful when the OR
is conceptually one filter:

```ts
import { sql, or } from '@uwdata/mosaic-sql';

// Inside a custom apply path, write a single clause with an OR predicate.
filter.selection.update({
  source: getFilterSource(filter),
  value: storedValue,
  predicate: or(
    sql`date_of_birth < '1950-01-01'`,
    sql`date_of_birth > '2000-01-01'`,
  ),
});
```

**B. External `Selection.union()` composed into the parent context.** Wire a
separate union selection alongside the filter-builder scope, then intersect
both into the final `filterBy`:

```tsx
const orSelection = useMosaicSelection('union');
const filterBy = useComposedSelection([page.context, orSelection]);
```

Clauses inside `orSelection` are not managed by the filter-builder UI; you
write to it directly with `orSelection.update(...)`.

Native OR support inside `useMosaicFilters` (e.g. a `mode: 'union'` scope
option) is a potential future addition — see
`docs/react/filter-builder-design.md`.

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

- page-level Add Filter and widget-local Add Filter catalogs
- active filters rendered from definitions instead of hardcoded fields
- a chart using `page.context`
- a page-scoped table
- a widget-local filter section and table using `page.context + widget.context`
