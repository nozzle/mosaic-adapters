---
'@nozzleio/mosaic-core': minor
'@nozzleio/react-mosaic': minor
'@nozzleio/mosaic-tanstack-table-core': minor
'@nozzleio/mosaic-tanstack-react-table': minor
---

**BREAKING — require `@uwdata/mosaic-core` and `@uwdata/mosaic-sql` `>=0.31.0 <1`** (and `@uwdata/vgplot` `>=0.31.0 <1` for the optional `@nozzleio/react-mosaic/vgplot` subpath). Upgrade the Mosaic packages together when installing any of the four adapter packages: `@uwdata/mosaic-core@0.31` depends on `@uwdata/mosaic-sql@^0.31`, and a mismatched pair nests a second SQL AST copy in the tree, which breaks the pre-aggregator's class-identity matching of clause `fields`.

No adapter APIs change. Mosaic 0.31 is adopted for its upstream hardening, which the adapters inherit as-is:

- Pre-aggregated materialized-view **creation** failures are now caught, logged through the coordinator's logger, and degrade to the standard query path (uwdata/mosaic#1158) — previously only a failing pre-aggregated **update** fell back. A wrong-but-valid pre-aggregated query still returns incorrect rows silently, so the `filterStable: false` guidance for grouped clients is unchanged.
- Window-expression detection in `@uwdata/mosaic-sql` is now whitespace/case tolerant (uwdata/mosaic#1145), and additional DuckDB aggregate names (`countif`, `list`, `sem`, `geometric_mean`, `arg_max_null`, …) are recognized (uwdata/mosaic#1143), so verbatim aggregate/window expressions in query factories are classified correctly in more cases.
