# Mosaic Adapters

A headless [Mosaic](https://idl.uw.edu/mosaic/) client library: reactive data clients (SQL query factory + native Selections/Params in, typed reactive store out) with React bindings and optional TanStack Table glue.

- **Get started:** [Build a dashboard](docs/build-a-dashboard.md) — walkthrough of the [athletes example](examples/react/athletes). For a bigger page (cross-filtering summary tables, membership subqueries, an active-filter chip bar), see the [nozzle-paa example](examples/react/nozzle-paa).
- **Packages:** [`@nozzleio/react-mosaic`](packages/react-mosaic) (re-exports [`@nozzleio/mosaic-core`](packages/mosaic-core)) and [`@nozzleio/mosaic-tanstack-react-table`](packages/mosaic-tanstack-react-table) (re-exports [`@nozzleio/mosaic-tanstack-table-core`](packages/mosaic-tanstack-table-core)). Install the framework packages only.
- **Docs:** [core concepts](docs/core/concepts.md), [React hooks](docs/react/hooks.md), [selection topology](docs/core/selection-topology.md) (name a page's Selection graph as data), [TanStack integration](docs/tanstack/integration.md).

## Want to contribute?

Please read our [contribution guidelines](CONTRIBUTING.md) before submitting a pull request.
