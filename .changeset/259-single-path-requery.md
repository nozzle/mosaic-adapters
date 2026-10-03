---
'@nozzleio/mosaic-core': minor
'@nozzleio/react-mosaic': minor
---

Issue one query when a single action writes a `filterBy` clause and Params. Clients that cannot pre-aggregate (`filterStable: false` — the default or forced value for the facet, sparkline, rollup and pivot clients — or a non-empty `skipSources`) now re-query `filterBy` changes through the same coalesced batch as Params, `havingBy`, `setInputs` and `invalidate()`, so a clause and a Param written in the same tick, in either order, build one query carrying both instead of two. A batch holding only `filterBy` changes is issued like upstream's standard selection update and leaves pre-aggregating siblings' materialized tables in place. Clients that can pre-aggregate keep upstream `Coordinator.updateSelection` unchanged.

Affected clients' brush-driven re-queries now wait one animation frame in a visible tab, where upstream queried synchronously. Opt a client out with the new `coalesceFilterBy: false` option (on every client factory, and a structural option on the React hooks) to keep upstream's immediate path. See "One query per action" in `docs/core/concepts.md` for write-order guidance on pre-aggregating clients.
