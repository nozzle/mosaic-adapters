# Facet client

`createFacetClient(options)` — distinct values of a column (with cascading counts) in, point/list clauses out. The data behind facet menus, filter dropdowns, and checkbox lists.

```ts
const sport = createFacetClient({
  coordinator,
  from: 'athletes',
  column: 'sport',
  filterBy: $page, // counts cascade with everything else on the page…
  publish: { as: $page }, // …but never with this facet's own clause
});
// sport.store.state → { options: [{value, count}], selected, … }
sport.toggle('swimming'); // publish; toggle the active value again to clear
sport.clear();
```

Under a crossfilter Selection the published clause carries the client in its `clients` set, so the options are filtered by every _other_ control on the page but never by their own selection — counts cascade, selected options never ghost away.

## Options query

The base relation (`from`: table name or query factory) is wrapped as `SELECT value[, count(*)] FROM (…) WHERE value IS NOT NULL GROUP BY value`. NULLs are excluded.

- `counts` (default `true`) — `count(*)` per value.
- `sort` — `'count'` (descending, default) or `'alpha'`; without counts, sort falls back to `'alpha'`.
- `arrayColumn` — the column is a DuckDB list (e.g. `VARCHAR[]`): options explode through `unnest()`, and published clauses match rows whose list contains any selected value (`list_has_any`).

## Inputs

`FacetInputs` is plain JSON: `{ search?: string, limit?: number }`. `search` is a case-insensitive substring match on the (stringified) option value; `limit` caps the option list. Both are value-diffed — a change re-queries exactly once.

## Selection modes

- `select: 'single'` (default) — `toggle(value)` replaces the active value; toggling the active value (or `toggle(null)`) clears.
- `select: 'multi'` — `toggle(value)` adds/removes it from the selected set, published as one `IN` clause (`clausePoints`); an empty set clears.

`selected` on the store always mirrors the published clause — including when an external actor (chip bar, `selection.reset()`) removes it. `destroy()` clears any published clause.

## Pre-aggregation

Filtering changes which option groups exist, so `filterStable` defaults to `false` for this client (overridable).
