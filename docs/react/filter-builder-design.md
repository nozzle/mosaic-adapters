# Filter Builder API Design

This document proposes a consumer-facing API for building page-level and widget-level filters without changing the current query topology.

The goal is to make UIs like the PAA top bar and richer filter-chip builders easy to implement while preserving the existing split:

- `@nozzleio/react-mosaic` owns `Selection` creation and topology wiring.
- Filter inputs write clauses into `Selection` instances.
- `@nozzleio/mosaic-tanstack-table-core` reads `Selection` predicates through `filterBy` and builds the actual queries.

This proposal does not expand the `CONDITION` operators yet. It focuses on the flow, public API shape, and the minimum implementation needed to make filter UIs easy to build.

## Goals

- Let consumers define a list of available filters in one place.
- Let consumers declare the value kind for each filter:
  - text
  - facet single-select
  - facet multi-select
  - date
  - date range
  - number
  - number range
- Let consumers declare which operators a filter allows.
- Keep page filters and widget-local filters separate, but composable.
- Make native React HTML implementations straightforward.
- Reuse the existing `Selection` and `filterBy` flow.

## Non-Goals

- Finalizing the full `CONDITION` type system.
- Shipping a polished component library.
- Replacing TanStack column filters.
- Hiding `Selection` entirely from advanced consumers.

## Existing Flow

The current flow is already structurally correct:

1. Page inputs write to page-owned `Selection` instances.
2. Selections are composed into contexts using derived selection helpers.
3. Tables, charts, and sidecars receive those contexts via `filterBy`.
4. Widgets may also have their own local selections.
5. A widget query should usually see:
   page context + widget-local context

That means the new API should be a schema and helper layer on top of the current topology, not a replacement for it.

## Proposed Mental Model

There are three layers:

1. Filter definitions
   A declarative schema describing what filters exist and how they behave.

2. Filter state
   Runtime state backed by `Selection` instances.

3. Filter topology
   Composition rules that decide which widgets see which selections.

The main design rule is:

`FilterDefinition` describes intent. `Selection` carries active state. `filterBy` applies it to queries.

## Proposed Public API

### 1. Filter Definition Schema

Consumers define their available filters in one place.

```ts
type FilterValueKind =
  | 'text'
  | 'facet-single'
  | 'facet-multi'
  | 'date'
  | 'date-range'
  | 'number'
  | 'number-range';

type FilterOperatorId = string;

interface FilterDefinition {
  id: string;
  label: string;
  column: string;
  valueKind: FilterValueKind;
  operators: Array<FilterOperatorId>;
  defaultOperator?: FilterOperatorId;

  facet?: {
    table: string | ((filter: unknown) => unknown);
    sortMode?: 'alpha' | 'count';
    columnType?: 'scalar' | 'array';
    limit?: number;
  };

  dataType?: 'string' | 'number' | 'date' | 'boolean';

  groupId?: string;
  description?: string;
}
```

This schema is intentionally UI-oriented. It tells the consumer what they can render without forcing them to understand table internals.

### 2. Filter Collections

Consumers should be able to declare page filters and widget-local filters separately.

```ts
interface FilterCollection {
  id: string;
  filters: Array<FilterDefinition>;
}
```

Example:

```ts
const pageFilters: FilterCollection = {
  id: 'page',
  filters: [
    {
      id: 'status',
      label: 'Status',
      column: 'status',
      valueKind: 'facet-single',
      operators: ['is', 'is_not', 'is_empty', 'is_not_empty'],
      defaultOperator: 'is',
      dataType: 'string',
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
      operators: ['between', 'before', 'after', 'is_empty', 'is_not_empty'],
      defaultOperator: 'between',
      dataType: 'date',
    },
  ],
};
```

### 3. Runtime Filter Controller Hook

Consumers need one entrypoint that turns definitions into runtime helpers.

Suggested React API:

```ts
interface UseMosaicFiltersOptions {
  definitions: Array<FilterDefinition>;
  scopeId: string;
}

function useMosaicFilters(options: UseMosaicFiltersOptions): {
  selections: Record<string, Selection>;
  definitions: Array<FilterDefinition>;
  getFilter: (id: string) => FilterRuntime | undefined;
  context: Selection;
};
```

Where:

```ts
interface FilterRuntime {
  definition: FilterDefinition;
  selection: Selection;
}
```

This hook should not try to hide the underlying `Selection`. The selection is still the durable primitive used elsewhere in the system.

### 4. Facet Helper Hook

Facet-backed filters should be easy to wire without consumers rebuilding the option-fetching logic.

Suggested API:

```ts
interface UseFilterFacetOptions {
  filter: FilterRuntime;
  filterBy?: Selection;
  additionalContext?: Selection;
  enabled?: boolean;
}

function useFilterFacet(options: UseFilterFacetOptions): {
  options: Array<string | number | boolean | Date | null>;
  selectedValues: Array<string | number | boolean | Date | null>;
  loading: boolean;
  hasMore: boolean;
  setSearchTerm: (term: string) => void;
  select: (value: unknown) => void;
  toggle: (value: unknown) => void;
  clear: () => void;
  loadMore: () => void;
};
```

This would be a thin wrapper over the existing facet menu client.

### 5. Value/Operator Binding Helpers

Consumers also need a simple way to bind native inputs without constructing predicates manually.

Suggested helper:

```ts
interface FilterBinding {
  operator: string | null;
  value: unknown;
  valueTo?: unknown;
  setOperator: (next: string) => void;
  setValue: (next: unknown) => void;
  setValueTo: (next: unknown) => void;
  clear: () => void;
  apply: () => void;
}

function useFilterBinding(filter: FilterRuntime): FilterBinding;
```

Important:

- This helper should own translating UI state into a single selection clause.
- Internally it can still emit the current `CONDITION` shape later.
- That keeps the consumer API stable even if the backing clause format changes.

## Native React HTML Story

The API should make these implementations trivial:

### Text

```tsx
function TextFilter({ filter }: { filter: FilterRuntime }) {
  const binding = useFilterBinding(filter);

  return (
    <input
      type="text"
      value={String(binding.value ?? '')}
      onChange={(e) => binding.setValue(e.target.value)}
      onBlur={binding.apply}
    />
  );
}
```

### Facet Single Select

```tsx
function StatusFilter({
  filter,
  filterBy,
}: {
  filter: FilterRuntime;
  filterBy?: Selection;
}) {
  const binding = useFilterBinding(filter);
  const facet = useFilterFacet({ filter, filterBy, enabled: true });

  return (
    <select
      value={String(binding.value ?? '')}
      onChange={(e) => {
        binding.setValue(e.target.value || null);
        binding.apply();
      }}
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

### Facet Multi Select

```tsx
function TagsFilter({
  filter,
  filterBy,
}: {
  filter: FilterRuntime;
  filterBy?: Selection;
}) {
  const facet = useFilterFacet({ filter, filterBy, enabled: true });

  return (
    <fieldset>
      {facet.options.map((option) => {
        const checked = facet.selectedValues.includes(option);
        return (
          <label key={String(option)}>
            <input
              type="checkbox"
              checked={checked}
              onChange={() => facet.toggle(option)}
            />
            {String(option)}
          </label>
        );
      })}
    </fieldset>
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
        onChange={(e) => binding.setValue([e.target.value || null, value[1]])}
      />
      <input
        type="date"
        value={value[1] ?? ''}
        onChange={(e) => binding.setValue([value[0], e.target.value || null])}
      />
      <button type="button" onClick={binding.apply}>
        Apply
      </button>
    </>
  );
}
```

## Proposed Topology API

The topology should stay explicit.

Consumers should still create:

- page-level filter scope
- optional widget-level filter scope
- explicit derived contexts

Suggested pattern:

```ts
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

Then:

- top bar filters write into `page.selections.*`
- widget-local controls write into `widget.selections.*`
- the widget table/chart gets `filterBy={widgetContext}`

This keeps the current model intact and avoids accidental coupling.

## Suggested Scope Types

This can stay lightweight:

```ts
type FilterScopeKind = 'page' | 'widget';

interface FilterScope {
  id: string;
  kind: FilterScopeKind;
  definitions: Array<FilterDefinition>;
  selections: Record<string, Selection>;
  context: Selection;
}
```

The main value is naming and consistency. It gives planning and docs a stable vocabulary.

## Proposed Package Placement

Recommended ownership:

- `@nozzleio/react-mosaic`
  - continues to own generic `Selection` and topology helpers
- `@nozzleio/mosaic-tanstack-react-table`
  - owns the new filter-builder schema and React hooks because this is the app-facing filter UX layer
- `@nozzleio/mosaic-tanstack-table-core`
  - continues to own predicate generation and query consumption

Reason:

- The proposed API is mostly React-facing and filter-UI-facing.
- It should sit next to `useMosaicTableFacetMenu`, `useMosaicTableFilter`, and the active-filter helpers.
- The headless core should not become responsible for UI schema semantics if we can avoid it.

## Example Strategy

The implementation should include a working example, not just new hooks and docs.

Recommendation:

- Modify the existing trimmed example app instead of creating a brand new workspace package.
- Add a dedicated view inside `examples/react/trimmed` for the filter-builder API.
- Do not retrofit the first pass directly into the existing PAA view, because that view already carries more topology complexity than is useful for validating the new API.

Preferred target:

- Add a new view beside the existing ones in `examples/react/trimmed/src/components/views`.
- Use a simple dataset and topology similar in complexity to `athletes-simple.tsx`.
- Demonstrate:
  - page-level filters
  - one table consuming page context
  - one chart consuming page context
  - one widget with additional widget-local filters
  - native HTML controls only

Why this approach:

- It gives a clean proving ground for the new API.
- It avoids conflating filter-builder work with existing example-specific abstractions.
- It leaves PAA available as a later follow-up integration target once the API is stable.

Fallback option:

- If adding a new view creates too much routing or example chrome work, modify `athletes-simple.tsx` to include:
  - top-level page filters
  - one widget-local filter section
  - native HTML controls bound through the new API

Avoid as the first pass:

- A new standalone example app package.
- A first implementation inside `nozzle-paa.tsx`.

## Recommended First Iteration

Do not start with a full component system.

Ship the smallest useful layer:

1. `FilterDefinition`
2. `useMosaicFilters`
3. `useFilterFacet`
4. `useFilterBinding`
5. A docs page showing native HTML examples

That is enough for a consumer to build:

- a top filter bar
- a widget-local filter section
- a filter chip list
- a custom UI matching the screenshots

## Implementation Notes

### Internal representation

The runtime helper should own translating:

- operator
- value
- optional second value

into the existing filter clause format.

The consumer should not build raw predicates.

### Active filter chips

The active-filter registry should eventually expose richer data than just `formattedValue`.

Needed later:

```ts
interface ActiveFilterDescriptor {
  id: string;
  label: string;
  operator?: string;
  value?: unknown;
  displayValue: string;
}
```

This is not required for the first iteration, but the design should leave room for it.

### Page vs widget ownership

Never merge widget-local filters back into the page filter scope.

The data flow should remain one-way:

- page scope influences all widgets
- widget scope influences only that widget

## Planning Breakdown

### Phase 1: Schema and runtime model

- Add `FilterDefinition` types.
- Add filter-scope hook that creates one `Selection` per filter.
- Add `context` composition for a scope.

### Phase 2: Binding helpers

- Add value/operator binding hook.
- Add helpers for clear, reset, and apply.
- Keep the emitted clause format internal.

### Phase 3: Facet integration

- Add facet helper that resolves facet config from the definition.
- Reuse existing sidecar behavior and cascading support.

### Phase 4: Docs and examples

- Add a docs page for native HTML filter controls.
- Add an example showing:
  - page filter bar
  - widget-local filters
  - table and chart sharing page context
  - one widget with extra local filters
- Prefer a new trimmed-example view for this, with `athletes-simple.tsx` as the fallback modification target.

### Phase 5: Active filter UX

- Improve active-filter metadata to carry operator/value display separately.
- Add a richer chip example.

## Implementation Plan

This section converts the design into an execution order that can be implemented safely in this repo.

### Delivery strategy

Build this in four shipped slices:

1. Types and scope creation
2. Binding and clause emission
3. Facet integration
4. Example and docs

Do not start with chips, polished UI, or PAA integration.

### Slice 1: Types and scope creation

Objective:

- establish the public API shape
- keep internals minimal
- prove page-scope and widget-scope composition

Package ownership:

- `packages/mosaic-tanstack-table-core`
  - shared public types only if they are genuinely headless
- `packages/mosaic-tanstack-react-table`
  - React-facing hooks and exported filter-builder API

Recommended file targets:

- `packages/mosaic-tanstack-table-core/src/types/general.ts`
- `packages/mosaic-tanstack-table-core/src/index.ts`
- `packages/mosaic-tanstack-react-table/src/index.ts`
- new files under `packages/mosaic-tanstack-react-table/src/`
  - `filter-builder-types.ts`
  - `filter-scope-hook.ts`

Tasks:

- Add `FilterValueKind`.
- Add `FilterDefinition`.
- Add `FilterCollection` only if it proves useful beyond examples and docs.
- Add `FilterRuntime`.
- Add `useMosaicFilters`.
- Have `useMosaicFilters` create one `Selection` per filter definition.
- Have `useMosaicFilters` expose:
  - `definitions`
  - `selections`
  - `getFilter(id)`
  - `context`

Important implementation constraint:

- `context` should be a stable derived selection that stays subscribed to all filter selections in the scope and seeds already-active clauses on mount.
- If a scope has no definitions, return a stable empty intersect selection rather than `null`.

Acceptance criteria:

- A consumer can declare page filters in one array.
- A consumer can create a page scope and a widget scope independently.
- A widget can compose `page.context` and `widget.context` and pass the result to `filterBy`.

Validation:

- add unit tests for `useMosaicFilters`
- run `pnpm test:types`
- run `pnpm test:lint`
- run `pnpm test:build`

### Slice 2: Binding and clause emission

Objective:

- make native HTML controls trivial to wire
- keep raw clause-shape knowledge out of consumer code

Package ownership:

- `packages/mosaic-tanstack-react-table`
  - binding hook
- `packages/mosaic-tanstack-table-core`
  - only touch internals if a small helper is needed for clause creation

Recommended file targets:

- new file under `packages/mosaic-tanstack-react-table/src/`
  - `filter-binding-hook.ts`
- possibly shared helpers under
  - `packages/mosaic-tanstack-react-table/src/filter-builder-helpers.ts`

Tasks:

- Add `useFilterBinding(filter)`.
- Keep local UI state in the hook:
  - `operator`
  - `value`
  - `valueTo`
- Add methods:
  - `setOperator`
  - `setValue`
  - `setValueTo`
  - `clear`
  - `apply`

Implementation rule:

- `apply()` is the only place that writes to the filter selection.
- For the first pass, explicit apply is safer than auto-apply for all value kinds.
- If needed, text inputs in examples can call `apply()` on blur or a button click.

Internal clause strategy:

- the hook should emit one selection clause per filter
- the clause format should be treated as internal to the helper
- do not force consumer code to build `FilterInput` or raw predicates directly

Important sequencing note:

- even if the first implementation uses a narrow internal operator mapping, the outward API should already accept `definition.operators`
- unsupported operators can be blocked at the binding layer until the internal mapping is implemented

Acceptance criteria:

- A native text input can update a text filter.
- A pair of date inputs can update a date-range filter.
- A select element can switch operator and value without manual predicate code.

Validation:

- add unit tests for `useFilterBinding`
- test clear/reset interaction with `SelectionRegistryProvider`
- run `pnpm test:types`
- run `pnpm test:lint`
- run `pnpm test:build`

### Slice 3: Facet integration

Objective:

- make facet-backed filters easy without custom sidecar wiring per consumer

Package ownership:

- `packages/mosaic-tanstack-react-table`

Recommended file targets:

- new file under `packages/mosaic-tanstack-react-table/src/`
  - `filter-facet-hook.ts`
- may reuse:
  - `packages/mosaic-tanstack-react-table/src/facet-hook.ts`
  - `packages/mosaic-tanstack-table-core/src/facet-menu.ts`

Tasks:

- Add `useFilterFacet`.
- Resolve facet options from `FilterRuntime.definition`.
- Delegate to the existing facet menu hook/client.
- Support:
  - single-select facet filters
  - multi-select facet filters
  - search term updates
  - `filterBy` for cascading
  - `additionalContext`

Design rule:

- `useFilterFacet` should not duplicate the current facet querying logic
- it should adapt filter definitions into the existing facet API

Acceptance criteria:

- A facet-single filter definition can drive a native `<select>`.
- A facet-multi filter definition can drive a checkbox list.
- Facet options can be constrained by external page/widget contexts.

Validation:

- add hook tests for `useFilterFacet`
- verify no regressions in existing facet hook tests
- run `pnpm test:types`
- run `pnpm test:lint`
- run `pnpm test:build`
- run `pnpm test:lib`

### Slice 4: Example and docs

Objective:

- prove the API in a consumer-realistic setup
- document the happy path before broadening operator semantics

Target example strategy:

- preferred: add a new view in `examples/react/trimmed/src/components/views`
- fallback: modify `athletes-simple.tsx`

Recommended example shape:

- page-level filters at the top
- one table consuming page context
- one chart consuming page context
- one widget with additional widget-local filters
- all controls implemented with native React HTML elements

Recommended file targets:

- `examples/react/trimmed/src/components/views/`
  - new dedicated filter-builder example view, or
  - `athletes-simple.tsx`
- `examples/react/trimmed/src/components/render-view.tsx`
  - only if needed to register a new view
- `docs/react/inputs.md`
- `docs/react/filter-builder-design.md`
- optionally a new focused doc:
  - `docs/react/filter-builder.md`

Tasks:

- Add filter definitions to the example.
- Create page scope and widget scope.
- Compose:
  - `page.context`
  - `widget.context`
  - final widget `filterBy`
- Render:
  - text input
  - select
  - checkbox list for multi-select facets
  - date inputs
- Show at least one widget-local filter section separate from page filters.

Documentation tasks:

- document the page-scope/widget-scope pattern
- document native HTML examples
- document that `filterBy` remains the final query input

Acceptance criteria:

- The example makes the topology obvious from the code.
- The example does not require shadcn or app-specific abstractions.
- The example demonstrates a consumer path that can later be dressed up into the richer UI.

Validation:

- run the example manually
- run `pnpm test:types`
- run `pnpm test:lint`
- run `pnpm test:build`
- run `pnpm test:e2e` if the view is user-visible in the trimmed example navigation

### Slice 5: Active filter chips

Objective:

- improve presentation for builder-style UIs
- keep this out of the critical path for the first rollout

Recommended file targets:

- `packages/mosaic-tanstack-table-core/src/filter-registry.ts`
- `packages/mosaic-tanstack-react-table/src/filter-registry.tsx`
- example files that render active filters

Tasks:

- enrich active filter descriptors with separate operator/value display fields
- teach the registry how to represent builder-emitted clauses cleanly
- add an example chip row closer to the target UI

Acceptance criteria:

- active filters can render `Status is Done` instead of a generic serialized value

Validation:

- add registry tests
- run `pnpm test:types`
- run `pnpm test:lint`
- run `pnpm test:build`

## Concrete Execution Order

Follow this sequence:

1. Add public types and exports.
2. Add `useMosaicFilters`.
3. Add tests for scope creation and context composition.
4. Add `useFilterBinding`.
5. Add tests for binding, apply, and clear behavior.
6. Add `useFilterFacet`.
7. Add tests for facet-backed definitions.
8. Build the trimmed example view.
9. Add or update docs.
10. Improve active filter metadata only after the example proves the core flow.

This order matters because it proves:

- the topology first
- the binding contract second
- the facet integration third
- the consumer experience fourth

## Risks and mitigations

### Risk: leaking internal clause shapes into consumer code

Mitigation:

- keep clause emission inside `useFilterBinding`
- avoid examples that manually construct low-level filter objects

### Risk: overfitting to the screenshot UI too early

Mitigation:

- ship native HTML examples first
- validate the flow before adding styled filter chips

### Risk: coupling widget-local filters into page filters

Mitigation:

- require explicit page scope and widget scope creation
- keep widget context composition one-way

### Risk: expanding `CONDITION` prematurely

Mitigation:

- accept operator ids in the public schema
- map only the minimal supported subset internally for the first pass

## Handoff checklist

Before implementation starts, the assignee should confirm:

- the first example target is a new trimmed-example view, not PAA
- native HTML controls are acceptable for the first pass
- explicit `apply()` behavior is acceptable for builder-style filters
- active filter chip enrichment is deferred until after the example lands

## Open Questions

- Should `useMosaicFilters` create one `Selection` per filter or support packing multiple filter values into one scope-owned selection?
  - Recommendation: one `Selection` per filter for clarity and easy reset.

- Should `FilterDefinition.facet.table` be required for facet kinds, or should it default from a surrounding table/query context?
  - Recommendation: allow explicit override, but support inheritance from a parent provider later.

- Should `useFilterBinding` auto-apply on every keystroke, or be explicit?
  - Recommendation: support both; default to explicit `apply()` for builder-style UIs.

- Should operators be free-form strings now, or typed ids from a shipped registry?
  - Recommendation: typed ids eventually, but string ids are acceptable for the first pass if we keep mapping centralized.

## Recommendation

The next implementation step should be a small React-facing schema layer on top of the existing selection flow.

Do not start by expanding `CONDITION`.

Start by making this easy for a consumer:

1. define filters
2. create page and widget scopes
3. bind native inputs
4. pass the resulting context into `filterBy`

That gives a stable foundation for the richer UI without forcing the internal predicate model to be finalized too early.
