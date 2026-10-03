---
'@nozzleio/mosaic-core': minor
'@nozzleio/react-mosaic': minor
---

Add a way to re-query a compiled query, and expose what the payload on screen answers.

- `client.invalidate()` re-queries because the query itself changed (for example after `setQuery(...)` with a recompiled factory). It is coalesced like an inputs change, so an `invalidate()` in the same tick as a `setInputs` issues one query, and unlike `refetch()` it keeps query-derived memos such as the rows client's `rowCount: 'query'` COUNT. While the client is disabled, the re-query runs once it is enabled.
- Every data-client hook (`useMosaicRows`, `useMosaicValues`, `useMosaicFacet`, `useMosaicHistogram`, `useMosaicSparkline`, `useMosaicRollup`, `useMosaicPivot`) takes an optional `queryKey` deps array, compared element-wise with `Object.is` like the `useVgPlot` deps. A change calls `client.invalidate()`; the first render never re-queries, and omitting it keeps the existing latest-ref behaviour. The option's type is exported as `QueryKeyOptions`.
- The store gains `settled: { inputs, query } | null` (type `DataClientSettled`): the inputs and SQL of the request whose response (or empty round) produced the current payload. It is `null` until the first successful response or empty round and moves only when the current request succeeds, so `status === 'pending' && settled === null` is the initial load and `settled.query !== lastQuery` means the payload answers an older query. `settled.query` is `null` for an empty round and for responses answered by the coordinator's pre-aggregation path.
