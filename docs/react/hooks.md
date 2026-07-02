# React bindings

`@nozzleio/react-mosaic` binds the [data clients](../core/concepts.md) to React. Install this package only — it re-exports the full `@nozzleio/mosaic-core` public API (the `@tanstack/react-table` distribution model; the core is a regular dependency, never a peer).

## Provider setup

Hooks resolve their coordinator in order: explicit `coordinator` option → nearest `MosaicProvider` → upstream Mosaic's global default coordinator (the one bare vgplot calls use).

```tsx
import { Coordinator } from '@uwdata/mosaic-core';
import { MosaicProvider } from '@nozzleio/react-mosaic';

const coordinator = new Coordinator(connector);

<MosaicProvider coordinator={coordinator}>
  <App />
</MosaicProvider>;
```

## The hooks

`useMosaicRows` and `useMosaicValues` are controlled bindings over `createRowsClient` / `createValuesClient`. They take the client options (minus the now-optional `coordinator`) and return the client's store state spread together with the client instance:

```tsx
const athletes = useMosaicRows<AthleteRow>({
  query: ({ where }) =>
    Query.from('athletes').select('id', 'name', 'sport', 'weight').where(where),
  filterBy: $page,
  inputs: {
    orderBy: sortingToOrderBy(sorting),
    ...paginationToWindow(pagination),
  },
  rowCount: 'window',
  publish: { select: { as: $picked, columns: ['id'] } },
});

// athletes.rows, athletes.totalRows, athletes.status, athletes.error,
// athletes.lastQuery, athletes.client (imperative: selectRows, hoverRow,
// prefetch, refetch)

const kpis = useMosaicValues<{ athletes: number; medals: number }>({
  query: ({ where }) =>
    Query.from('athletes')
      .select({ athletes: count(), medals: sum('gold') })
      .where(where),
  filterBy: $page,
});
```

## The three option-identity rules

How a hook reacts to an option change depends on which of three classes the option is in. The rule of thumb: **every option with a core setter is diffed into that setter; everything else is structural.**

1. **Structural identity** — `coordinator`, `filterBy`, `havingBy`, `params` (each Param instance), `publish` (Selections, columns, throttle), `inputMode`, `filterStable`, `rowCount`. Changing any of these destroys the client and creates a new one (fresh store, new first query). Keep them stable — module scope, `useState`, or `useMemo`.
2. **Latest-ref** — `query` and `coerce` (React-Query `queryFn` style). New function identities never recreate the client and never re-query; the next query, whatever triggers it, is built from the latest functions. Inline closures are free.
3. **Value-diffed** — `inputs` is compared by value and forwarded through `setInputs`; a value-equal object with fresh identity is a no-op. The option fully owns the inputs: a key present on the previous render and absent now is cleared. `enabled` forwards through `setEnabled`.

Re-query triggers are exactly: inputs change, Selection activation, Param change, `refetch()`.

## Status semantics

The hooks report React-Query semantics: while `enabled`, a client that has not completed its first query reports `'pending'` from the very first render; `'idle'` surfaces only while `enabled: false`. (The core store itself stays `'idle'` until the first query actually starts — the hook derives the difference.)

## Lifecycle

Clients are created once per mount and destroyed on unmount; StrictMode's double-mount destroys the first client and transparently recreates it (connect/disconnect stay symmetric — no dangling coordinator clients). The client is created disabled during render and enabled after commit, so the first query belongs to the mounted component.
