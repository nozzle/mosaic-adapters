# `example-react-athletes`

The executable north star of the [data-first re-architecture](https://github.com/nozzle/mosaic-adapters/issues/131):
an athletes dashboard where every piece of rendered data flows through a
Mosaic data client, and the whole page cross-filters through one
`Selection.crossfilter()`.

- **KPI cards** — one values client, N KPIs per round trip, re-queried by a
  `Param`-driven metric select.
- **Weight × height scatterplot** — native vgplot via `useVgPlot`; its brush
  publishes into the page Selection and filters everything else.
- **The table** — user-owned `useReactTable` in fully manual mode: sorting and
  pagination execute in SQL as serializable rows-client inputs, column filters
  become Selection clauses through the TanStack Table filter bridge, and row clicks
  publish picked athletes into a `$picked` Selection.

The sport facet select, brushable histogram, and sparkline column arrive with
their clients in Phase 5 ([#163](https://github.com/nozzle/mosaic-adapters/issues/163)).

## Run it

```bash
pnpm --filter example-react-athletes dev
```

## E2E

```bash
pnpm --filter example-react-athletes test:e2e
```

The e2e suite is the integration test for the whole stack: SQL-executed
sorting/pagination/filtering, brush → table + KPIs, column filters → plot +
KPIs, and Param-driven re-query.
