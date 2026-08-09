---
'@nozzleio/mosaic-core': minor
'@nozzleio/react-mosaic': minor
'@nozzleio/mosaic-tanstack-table-core': minor
'@nozzleio/mosaic-tanstack-react-table': minor
---

**BREAKING — require `@uwdata/mosaic-core` and `@uwdata/mosaic-sql` `>=0.30.0 <1`.** Upgrade both Mosaic packages to 0.30 or newer when installing any of the four adapter packages. The two floors move together because `@uwdata/mosaic-core@0.30` itself depends on `@uwdata/mosaic-sql@^0.30`: pairing it with an older SQL release would leave two copies of the SQL AST in the tree, and Mosaic's pre-aggregator matches clause `fields` to predicate nodes by class identity.

Main data-client query failures now retain Mosaic 0.30's `QueryError` in `store.state.error`. The public state type stays `Error | null`, while consumers can narrow with `instanceof QueryError` from `@uwdata/mosaic-core` to inspect the coordinator-issued SQL via `.sql` and the underlying failure via `.cause`. Schema field-info failures remain plain errors because that path queries the coordinator directly.

Separate rows-count failures (`rowCount: 'query'`) are reported through the coordinator's logger and retried on a later build, leaving the successful main query's `status`/`error` untouched — a failed side-channel count must not wedge rows that loaded fine.

Mosaic 0.30 also retries the standard (non pre-aggregated) query when a pre-aggregated selection update returns a `QueryError`, so a client that wrongly claims `filterStable` and produces a failing optimizer path degrades to a correct, slower query instead of getting stuck. A wrong-but-valid pre-aggregated query still returns incorrect rows with no error, so the `filterStable: false` guidance for grouped clients is unchanged.
