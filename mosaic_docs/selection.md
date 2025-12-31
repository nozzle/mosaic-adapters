# Selection API

/* 
 * Selections manage SQL predicates and coordinate filtering across 
 * multiple interactive components.
 */

A `Selection` is a specialized `Param` that stores one or more SQL clauses. It is the primary tool for building "Linked Views" and "Cross-filtering."

## Resolution Strategies

Selections define how to merge clauses from different sources:
- **`Selection.intersect()`**: Combines clauses with `AND` (Intersection).
- **`Selection.union()`**: Combines clauses with `OR` (Union).
- **`Selection.single()`**: Only maintains the most recent clause.

## Cross-Filtering Configuration

The `cross` option determines if a client is filtered by its own interactions:
- **`cross: false` (Default)**: The selection filters all linked clients equally.
- **`cross: true`**: When a client updates the selection, that client is *not* filtered by the resulting predicate. This is essential for histograms where you want to see the "full" distribution while selecting a range.

## Methods

### `update(clause)`
Adds or updates a clause. A clause object requires:
- `source`: The component providing the update.
- `value`: The raw data (e.g., `[min, max]`).
- `predicate`: The SQL AST node (e.g., `isBetween(column("age"), [20, 30])`).

### `predicate(client)`
Returns the resolved SQL predicate for the given client. If cross-filtering is enabled, this method automatically omits clauses authored by that client.

### `value`
Returns the raw value of the active (most recent) clause.