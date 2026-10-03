---
'@nozzleio/mosaic-core': patch
---

Freeze each main query at the Param values it was built with. A query that interpolates a live Param (``sql`… ${param}` ``, `column(param)`) used to re-render with the Param's newest value whenever the coordinator stringified it, so a Param change while a request was queued or in flight could send, cache or report (`QueryError.sql`) that request under SQL it was not built from, and an older request's failure could count as the current one. The client now hands the coordinator a copy pinned to the build-time SQL (also under query consolidation); your own query object is not modified and keeps rendering live.
