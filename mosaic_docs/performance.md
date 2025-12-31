# Performance and Optimization

/* 
 * This document outlines the advanced optimization strategies utilized 
 * by Mosaic to maintain interactive performance over massive datasets, 
 * including pre-aggregation, caching, and query consolidation.
 */

Mosaic is built to handle "Big Data" on the web. While DuckDB provides the raw analytical power, Mosaic provides the orchestration layer to ensure that power is used efficiently.

## 1. Materialized Pre-Aggregation
When dealing with billions of rows, calculating a histogram on every mouse move is too slow. Mosaic solves this with **Materialized Views**.

- **The Pattern**: If a Client query is "stable" (meaning the `GROUP BY` or binning logic doesn't change, only the `WHERE` clause does), the Coordinator can pre-aggregate the data into a smaller "Data Cube."
- **Implementation**: Ensure your client returns `true` for the `filterStable` property.
- **Result**: Instead of scanning 1 billion rows, DuckDB scans a pre-aggregated table of perhaps 500 rows, making updates nearly instantaneous.

## 2. Query Consolidation
Mosaic automatically "deduplicates" outgoing queries.
- If five different components (e.g., a total count label, a mean delay label, and a max distance label) all request data from the same table with the same filter, the Coordinator merges these into a single SQL statement.
- This reduces network overhead and allows the database engine to optimize the scan.

## 3. Intelligent Caching
The Coordinator maintains an LRU (Least Recently Used) cache of query results.
- **Deterministic Keys**: Cache keys are generated from the stringified SQL.
- **Bypassing the Cache**: You can force a fresh query by passing `cache: false` in the `query` options.
- **Server-Side Persistence**: Using the `persist` option with the Mosaic Data Server allows query results to be cached on the server's filesystem, surviving page reloads and browser restarts.

## 4. Prioritization and Throttling
Mosaic manages a priority queue to prevent "UI jank":
- **Priority Levels**: 
    - `Priority.High`: For active interactions (e.g., the chart the user is currently brushing).
    - `Priority.Normal`: For standard data loads.
    - `Priority.Low`: For prefetching data the user *might* need next.
- **Throttling**: Components should use `client.requestUpdate()` during high-frequency events (like `mousemove`). This ensures Mosaic doesn't flood the database with more queries than it can resolve per frame.

## 5. Indexing and Data Types
Mosaic is most performant when DuckDB can utilize its columnar format:
- **Parquet**: Use Parquet files whenever possible; they allow DuckDB to skip reading columns that aren't in your `SELECT` clause.
- **Date Binning**: Use Mosaic’s built-in date functions (`dateBin`, `dateMonth`) which are translated into optimized DuckDB internal functions.