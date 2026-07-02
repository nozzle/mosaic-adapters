# Filter builder

Declarative, persistable filter definitions over native Selections: define what a filter is (`FilterDefinition`), bind UI to it (`FilterBindingController` / the React hooks), and every apply publishes a clause whose stored value is JSON — so filters serialize, persist, and hydrate without touching SQL.

The subsystem lives in `@nozzleio/mosaic-core` (framework-agnostic) with React bindings in `@nozzleio/react-mosaic`; it is Selection-native and composes with every data client: a scope's `context` Selection is just a `filterBy`/`havingBy`.

## Definitions

Eight `valueKind`s — `text`, `facet-single`, `facet-multi`, `date`, `date-range`, `number`, `number-range` — each with an operator registry (`TEXT_CONDITIONS`, `SELECT_CONDITIONS`, `MULTISELECT_SCALAR_CONDITIONS`, `MULTISELECT_ARRAY_CONDITIONS`, `DATE_CONDITIONS`, `DATE_RANGE_CONDITIONS`, `NUMBER_CONDITIONS`, `NUMBER_RANGE_CONDITIONS`):

```ts
const nameFilter: FilterDefinition = {
  id: 'name',
  label: 'Athlete',
  column: 'name',
  valueKind: 'text',
  operators: [TEXT_CONDITIONS.CONTAINS, TEXT_CONDITIONS.EQUALS],
  defaultOperator: TEXT_CONDITIONS.CONTAINS,
  dataType: 'string',
};
```

- `columnType: 'array'` targets DuckDB list columns (`list_has_any` / `list_has_all` predicates, array-aware empty semantics).
- `facet: { from, sortMode?, limit? }` sources dropdown options through the facet data client (see `useFilterFacet`).
- `subquery: ({ state, contextPredicate }) => Query | { query, negate } | null` builds membership filters (`column [NOT] IN (SELECT …)`). The factory receives sibling-filter context from the runtime's `context` Selection (own clause excluded) and is re-run when that context changes — published through `createSubqueryClause`, so the predicate never carries optimizer `meta`.

## Applying

Operator aliases (`is`, `is_any_of`, `between`, `does_not_contain`, …) resolve to canonical predicates (`eq`, `IN` collections, `BETWEEN`, `ILIKE` with escaped patterns via `TRY_CAST`-typed column access). The clause's `value` is a `StoredFilterValue` envelope — `{ mode, operator, value, valueTo, dataType, filterId, scopeId }` — which is what persisters serialize and what hydration replays.

Core helpers: `applyFilterSelection(runtime, state, target?)` (target `'where' | 'having'` — HAVING routing for aggregate filters), `clearFilterSelection`, `readFilterSelectionState`, `reapplyCommittedFilterSelection` (context-driven subquery rebuild, convergence-guarded), `normalizeFilterBindingState`, `getFacetSelectedValues`. `FilterBindingController` wraps a runtime with a `@tanstack/store` of uncommitted UI state (`setOperator`/`setValue`/`setValueTo`/`apply`/`clear`) that syncs back from external Selection changes.

## React

- `useMosaicFilters({ scopeId, definitions, persister? })` — one Selection per definition plus a composed `context` Selection (the AND of the scope); `getFilter(id)` returns each `FilterRuntime`. Scope persisters hydrate/write sparse `{ filterId → FilterBindingState }` snapshots.
- `useFilterBinding(runtime, { persister?, filterClauseTarget? })` — controlled binding for one filter editor.
- `useFilterFacet({ filter, filterBy?, additionalContext?, enabled? })` — facet options via the facet data client (search, count/alpha sort, limit + `loadMore`), with `select`/`toggle`/`clear` publishing through the filter-builder clause path; committed selections merge into the options even when the cascade filters them away.
- Topology helpers: `useMosaicSelections(keys, type)`, `useCascadingContexts(inputs, externals)` (peer-minus-self contexts against the ghost-option bug), `useComposedSelection(selections)`.

The chip-bar/registry layer (global reset across scopes) is not part of this port — it arrives with the PAA rebuild's filter registry.
