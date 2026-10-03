---
'@nozzleio/mosaic-core': minor
'@nozzleio/react-mosaic': minor
---

Stop reporting a cancelled main query as a failure. When `coordinator.cancel()` or `coordinator.clear()` rejects a client's current request with `'Canceled'`/`'Cleared'`, the store now keeps `status: 'pending'` (and its previous `error`) until the next trigger re-queries, instead of switching to `status: 'error'`.

Add two helpers, also re-exported from `@nozzleio/react-mosaic`:

- `isQueryCancellation(error)` recognises a cancellation in every shape Mosaic delivers it (bare string, `Error`, or a `QueryError` whose `cause` is one), so you no longer need to string-match Mosaic internals.
- `describeQueryError(error)` splits a failure into a display `message`, the `sql` (for a `QueryError`) and its `cause`, so a UI can show the message without the SQL that `QueryError.message` embeds. It returns `null` for no error.
