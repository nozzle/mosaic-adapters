# `@nozzleio/react-mosaic`

React bindings for the [Mosaic](https://idl.uw.edu/mosaic/) data clients in `@nozzleio/mosaic-core`.

The hooks are **controlled bindings**: you own the state (sorting, pagination, filters), the hooks diff options into a framework-agnostic data client, and a reactive store flows back out. The full `@nozzleio/mosaic-core` public API is re-exported from this package's entry point — install this package only.

## Install

```bash
npm install @nozzleio/react-mosaic @uwdata/mosaic-core @uwdata/mosaic-sql
```

## Usage

```tsx
import { Selection } from '@uwdata/mosaic-core';
import { Query } from '@uwdata/mosaic-sql';
import { MosaicProvider, useMosaicRows } from '@nozzleio/react-mosaic';

const $page = Selection.crossfilter();

function AthletesTable() {
  const athletes = useMosaicRows<AthleteRow>({
    query: ({ where }) =>
      Query.from('athletes').select('id', 'name', 'sport').where(where),
    filterBy: $page,
    inputs: { orderBy: [{ column: 'name' }], limit: 25, offset: 0 },
    rowCount: 'window',
  });
  // athletes.rows, athletes.totalRows, athletes.status, athletes.client
}
```

Wrap your app in `<MosaicProvider coordinator={...}>` (or pass `coordinator` per hook; the upstream global coordinator is the final fallback).

## What lives here

- `MosaicProvider` / `useMosaicCoordinator` — coordinator context.
- `useMosaicRows`, `useMosaicValues` — controlled-binding hooks over the rows/values clients.
- `useMosaicSelection(type?)` — one stable `Selection` (companion to `useMosaicSelections`) for `filterBy`/`havingBy` wiring and sibling-widget pub/sub.
- `useVgPlot` — mount a vgplot element and disconnect its clients on unmount.
- Everything from `@nozzleio/mosaic-core`, re-exported.

See `docs/react/` in the repository for hook semantics (the option-identity rules) and `docs/core/` for the client contract.
