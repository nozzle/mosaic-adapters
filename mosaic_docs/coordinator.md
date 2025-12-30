# Coordinator API

/* 
 * The Coordinator manages the lifecycle of queries and the synchronization 
 * of reactive components within the Mosaic ecosystem.
 */

The `Coordinator` is the central message bus. It ensures that queries are executed efficiently and that UI components stay in sync with the underlying data.

## Connection Management

### `connect(client)`
Registers a `MosaicClient` with the coordinator. This initiates the client lifecycle:
1. `client.fields()` is called to gather metadata.
2. `client.query()` is called to fetch initial data.
3. The client is added to the internal registry for reactive updates.

### `disconnect(client)`
Removes the client and stops all reactive updates for it.

## Query Execution

### `query(query, options)`
Executes a SQL query and returns a Promise resolving to the data.
- **options.type**: `"arrow"` (default) or `"json"`.
- **options.priority**: 
    - `Priority.High`: For immediate interactions (e.g., brushing).
    - `Priority.Normal`: For standard updates.
    - `Priority.Low`: For background tasks or prefetching.
- **options.cache**: Boolean (default `true`). If enabled, identical queries return cached results.

### `exec(query)`
Executes SQL without returning a result set. Useful for `CREATE TABLE`, `INSERT`, or `ATTACH DATABASE` commands.

## Performance Features

### `prefetch(query)`
Issues a low-priority query to warm the cache. If a client later requests the same data, the result will be returned instantly.

### `clear(options)`
Resets the coordinator state. 
- `options.clients`: Disconnect all clients.
- `options.cache`: Flush the query cache.