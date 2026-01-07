# Mosaic Architecture

/\*

- This file explains the high-level conceptual model of Mosaic,
- focusing on the interaction between the Coordinator, Database, and Clients.
  \*/

Mosaic is a framework for linking databases and interactive views. It follows a "Pushdown Computation" model, where the heavy lifting of data processing is moved out of the browser's main thread and into a specialized database engine (typically DuckDB).

## The Mosaic Lifecycle

1. **Interaction**: A user interacts with a component (e.g., moves a brush on a plot).
2. **Predicate Update**: The component updates a `Selection`. This Selection generates a SQL `WHERE` clause (a predicate).
3. **Query Coordination**: The `Coordinator` detects the change. It gathers queries from all `Clients` that depend on that Selection.
4. **Pushdown Execution**: The Coordinator sends the optimized SQL queries to the database (DuckDB).
5. **Reactive Return**: The database returns aggregated results (often in Apache Arrow format). The Coordinator routes this data back to the specific Clients.
6. **Rendering**: The Clients (plots, tables, labels) re-render using only the small, summarized data they received.

## Key Primitives

- **Coordinator**: The central hub. It manages the query queue, caching, and client registration.
- **Clients**: Data consumers. They define _what_ data they need via SQL and _how_ to show it.
- **Params & Selections**: Reactive state. Params hold single values; Selections hold SQL filters.
- **Connectors**: The bridge to the database, supporting Wasm (in-browser), Web Sockets, or REST.
