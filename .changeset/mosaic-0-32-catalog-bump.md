---
'@nozzleio/mosaic-core': minor
'@nozzleio/react-mosaic': minor
'@nozzleio/mosaic-tanstack-table-core': minor
'@nozzleio/mosaic-tanstack-react-table': minor
---

**BREAKING — require `@uwdata/mosaic-core` and `@uwdata/mosaic-sql` `>=0.32.0 <1`** (and `@uwdata/vgplot` `>=0.32.0 <1` for the optional `@nozzleio/react-mosaic/vgplot` subpath). Upgrade the Mosaic packages together when installing any of the four adapter packages: `@uwdata/mosaic-core@0.32` depends on `@uwdata/mosaic-sql@^0.32`, and a mismatched pair nests a second SQL AST copy in the tree, which breaks the pre-aggregator's class-identity matching of clause `fields`.

No adapter APIs change. Adapting to Mosaic 0.32:

- Clearing a multi-select facet (`select: 'multi'`) or a rows client's row selection/hover (`selectRows([])`, `setSelectedValues([])`, `hoverRow(null)`, destroy-time cleanup) still **removes** the published clause. Mosaic 0.32's `clausePoints` turns an empty value list into an active `FALSE` predicate (uwdata/mosaic#1256), which would otherwise have filtered every consumer down to zero rows; these paths now publish a clear clause instead.
- Mosaic 0.32 drops JSON query transport and moves Arrow IPC decoding from connectors into the coordinator's `QueryManager` (set IPC extraction options with `new Coordinator(connector, { ipc })`). Custom `Connector` implementations must return raw Arrow IPC bytes for `arrow` queries; the built-in `wasmConnector`/`socketConnector`/`restConnector` already do.
- The `QueryManager` now shares one in-flight connector request between concurrent requests for identical SQL (uwdata/mosaic#1171), so a `refetch()` that rebuilds the same SQL as a pending query joins it rather than issuing a second round trip. The current-request guarantee is unaffected: the store settles once, on the current request.
- Date literals in generated SQL are now zero-padded (`DATE '2024-01-01'`).

The adapters' own current-request guarantee and the `skipSources` projection in front of the coordinator remain in place: upstream `Coordinator.updateClient` still delivers completions without request identity, and `updateSelection` still re-queries on every `'value'` event without comparing predicates.
