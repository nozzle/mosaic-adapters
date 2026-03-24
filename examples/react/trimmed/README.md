# `example-react-trimmed`

Trimmed React example app for the publishable Mosaic adapter packages.

## Dashboards

- `athletes`: full dashboard with charts, histograms, table filters, and grouped rows
- `athletes-simple`: first-principles table setup without the mapping helper
- `nyc-taxi`: aggregation-driven summary/detail pattern
- `nozzle-paa`: multi-table topology with active filter chips and KPI queries

## What it demonstrates

- `@nozzleio/react-mosaic` for connector state, coordinator context, and selection lifecycle
- `@nozzleio/mosaic-tanstack-react-table` for table hooks and active-filter APIs
- connection-scoped `SelectionRegistryProvider` and `MosaicFilterProvider` keyed by `connectionId`
- dual-mode execution with browser WASM and remote HTTP Arrow queries

## Run it

```bash
pnpm --filter example-react-trimmed dev
```

Other useful commands:

```bash
pnpm --filter example-react-trimmed build
pnpm --filter example-react-trimmed test:e2e
```

Workspace-wide `pnpm test:types` also covers this example through Nx.

## Remote mode environment

The app reads these Vite env vars:

- `VITE_REMOTE_DB_URL`: remote query endpoint, defaults to `http://localhost:3000`
- `VITE_API_TOKEN`: optional bearer token for remote requests
- `VITE_TENANT_ID`: optional tenant header for remote requests

Remote mode uses `HttpArrowConnector` directly. The Nozzle PAA dashboard still uses the local `/data-proxy/*` route in WASM mode so the browser can fetch the parquet fixture without CORS issues.

## Notes

- Active-filter helpers intentionally come from `@nozzleio/mosaic-tanstack-react-table`, not `@nozzleio/react-mosaic`.
- If you change connector inputs, `RenderView` passes a `connectionKey` so the provider reconnects with the latest remote config.
