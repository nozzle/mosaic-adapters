# Architecture

Mosaic is an extensible framework for linking databases and interactive views. It uses a decoupled architecture where data processing is offloaded to a high-performance database, while the browser handles interaction and rendering.

## The Middle-Tier Model

Mosaic acts as a middle-tier between visualization components and data sources. Unlike traditional libraries that load all data into browser memory, Mosaic sends SQL queries to a backing database (like DuckDB) and receives only the aggregated results necessary for display.

## Reactive Data Flow

1. **Interactors**: Components like brushes or sliders update a `Selection` or `Param`.
2. **Coordinator**: Monitors selections and manages a queue of SQL queries.
3. **Database**: Executes queries (potentially over millions or billions of rows).
4. **Clients**: Visual components receive the query results and update their display.

## Key Primitives

- **Coordinator**: The central hub for query management and client synchronization.
- **Client**: Any component that requests data via SQL and renders the result.
- **Param**: A reactive variable representing a single value.
- **Selection**: A specialized Param that manages SQL predicates for filtering.
