---
'@nozzleio/mosaic-core': patch
---

fix(core): the `'date'` coerce descriptor now scales microsecond-epoch bigints to milliseconds. Parquet/DuckDB `TIMESTAMP` columns surface as µs bigints; without the magnitude check they decoded to a far-future date (~year 57000). A bigint past ~year 2286 in ms is now treated as µs and divided by 1000 before constructing the `Date`.
