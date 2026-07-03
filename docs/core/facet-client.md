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

## Infinite scroll and search

The client fetches a single window (`search` + `limit`); the page-state around it — a growing limit, a debounced search box, keeping selected values visible when they scroll out of the window — is consumer-owned. Wire it over `search`/`limit` and `state.options`/`state.selected`:

```tsx
const PAGE = 50;

function useSportFacet(searchInput: string) {
  // debounce with whatever you already use; only the debounced term hits inputs
  const search = useDebouncedValue(searchInput, 200);
  const [limit, setLimit] = React.useState(PAGE);

  const facet = useMosaicFacet({
    from: 'athletes',
    column: 'sport',
    publish: { as: $page },
    inputs: { search: search || undefined, limit },
  });

  // selected values outside the fetched window (or filtered out by the
  // cascading context) stay renderable — union them back in.
  const options = React.useMemo(() => {
    const merged = [...facet.options];
    for (const value of facet.selected) {
      if (!merged.some((o) => Object.is(o.value, value))) {
        merged.push({ value });
      }
    }
    return merged;
  }, [facet.options, facet.selected]);

  return {
    options,
    toggle: facet.client.toggle,
    hasMore: facet.options.length >= limit, // a full page ⇒ there may be more
    loadMore: () => setLimit((n) => n + PAGE),
  };
}
```

`loadMore` bumps `limit` (each change re-queries once); `hasMore` is `true` while the last page came back full. The debounce is yours — the client re-queries on every distinct `search` value, so debounce before it reaches `inputs`.

## Selection modes

- `select: 'single'` (default) — `toggle(value)` replaces the active value; toggling the active value (or `toggle(null)`) clears.
- `select: 'multi'` — `toggle(value)` adds/removes it from the selected set, published as one `IN` clause (`clausePoints`); an empty set clears.

`selected` on the store always mirrors the published clause — including when an external actor (chip bar, `selection.reset()`) removes it. `destroy()` clears any published clause.

`setSelected(values)` replaces the selection wholesale and publishes (single-select keeps at most the first value; `[]` clears). Use it to replay stored intent — router search params, or the `persist` adapter below.

## Persistence

`persist?: Persister<Array<unknown>>` stores the selected values (see [concepts](./concepts.md#persistence)). A synchronous `read` hydrates before the first query; requires a `publish` target (a warning fires and persistence is ignored without one).

## Pre-aggregation

Filtering changes which option groups exist, so `filterStable` defaults to `false` for this client (overridable).
