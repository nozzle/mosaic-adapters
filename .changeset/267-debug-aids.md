---
'@nozzleio/mosaic-core': minor
'@nozzleio/react-mosaic': minor
---

Add debugging aids to data clients.

- A `meta` option (type `DataClientMeta`) attaches consumer-owned debugging metadata (a widget id, a label) to a client. It is exposed as `client.meta`, replaced with `client.setMeta(...)`, and never read by the library or included in the query: it is held by latest-ref, so changing it never re-queries, and the React data-client hooks accept it without ever recreating the client. The client mirrors it onto `client.mosaicClient` under the registered symbol `MOSAIC_CLIENT_META`; `getClientMeta(mosaicClient)` reads it back, so coordinator-level observers can attribute each query to the widget that issued it.
- `client.previewQuery(options?)` returns `{ main, count }` (type `QueryPreview`): the SQL the client would issue for its current filters and inputs, or for `where`/`having`/`inputs` overrides (`QueryPreviewOptions`), without issuing anything or touching the store. `count` is the rows client's `rowCount: 'query'` COUNT SQL and `null` otherwise. The SQL text is not a stable format.
- In development (`process.env.NODE_ENV` set and not `'production'`), a client warns once when its query factory is handed an active `where` or `having` predicate and never reads it, since the resulting query silently ignores that filter. Reading the predicate (`void ctx.where`) acknowledges a deliberate omission. Production builds and environments without `NODE_ENV` never warn.
