/**
 * @file Types for server-side grouped/hierarchical table support.
 *
 * Defines the data model for rows that form a tree structure where each level
 * is loaded lazily from the server via GROUP BY queries, plus optional raw
 * leaf rows at the deepest level.
 *
 * Uses a discriminated union (`ServerGroupedRow = GroupRow | LeafRow`) so
 * consumers can narrow with `row.type === 'group'` or `row.type === 'leaf'`.
 */
import type { ExprValue } from '@uwdata/mosaic-sql';

/**
 * Separator used between segments in row IDs.
 * ASCII 31 (Unit Separator) — never appears in real data values.
 *
 * Row IDs encode the full ancestor path because each depth level comes from
 * a *separate* SQL query result. Unlike client-side grouping (where TanStack
 * owns the full dataset and can resolve parent→child via `getSubRows`),
 * server-side grouped rows arrive as flat query results — e.g. the root query
 * returns `[{ nationality: "USA", count: 500 }, ...]` and a child query
 * returns `[{ sport: "Swimming", count: 42 }, ...]`. The ID scheme stitches
 * these disconnected results into a coherent tree:
 *
 *   "USA"                    → root group (nationality)
 *   "USA\x1FSwimming"        → child group (sport) under USA
 *   "USA\x1FSwimming\x1FM"   → child group (gender) under USA→Swimming
 *   "USA\x1FSwimming\x1FM\x1F_leaf_42" → leaf row under USA→Swimming→M
 *
 * The ID also lets us reconstruct the SQL WHERE clause for any child query:
 * splitting "USA\x1FSwimming" by the separator yields the constraint
 * `WHERE nationality = 'USA' AND sport = 'Swimming'`.
 */
export const GROUP_ID_SEPARATOR = '\x1F';

/**
 * Defines a column to display in raw leaf rows.
 *
 * @example
 * const leafColumns: LeafColumn[] = [
 *   { column: 'unique_key', label: 'ID', width: 80 },
 *   { column: 'created_date', label: 'Created', width: 120, format: 'date' },
 *   { column: 'status', label: 'Status', width: 100 },
 * ];
 */
export interface LeafColumn {
  /** The SQL column name to fetch. */
  column: string;
  /** Human-readable label for the column header. */
  label?: string;
  /** Optional width hint in pixels. */
  width?: number;
  /** Optional format hint: 'date', 'datetime', 'number', or undefined for text. */
  format?: 'date' | 'datetime' | 'number';
}

/**
 * Defines a single level in the group hierarchy.
 *
 * @example
 * const levels: GroupLevel[] = [
 *   { column: 'complaint_type', label: 'Complaint Type' },
 *   { column: 'descriptor', label: 'Descriptor' },
 *   { column: 'resolution_description', label: 'Resolution' },
 * ];
 */
export interface GroupLevel {
  /** The SQL column name to GROUP BY at this level. */
  column: string;
  /** Human-readable label for display. Falls back to `column` if omitted. */
  label?: string;
}

/**
 * Defines an aggregation metric computed at each group level.
 *
 * @example
 * const metrics: GroupMetric[] = [
 *   { id: 'count', expression: mSql.count(), label: '311 Requests' },
 * ];
 */
export interface GroupMetric {
  /** The alias for this metric in the SELECT clause. */
  id: string;
  /** A mosaic-sql expression (e.g., `mSql.count()`, `mSql.sum('amount')`). */
  expression: ExprValue;
  /** Human-readable label for the column header. */
  label?: string;
}

// ---------------------------------------------------------------------------
// Row types — discriminated union
// ---------------------------------------------------------------------------

/** A row in the grouped tree. Either a group (aggregated) or a leaf (raw data). */
export type ServerGroupedRow = GroupRow | LeafRow;

/**
 * An aggregated group row with metrics and optional children.
 *
 * Each GroupRow carries embedded metadata (`_depth`, `_parentConstraints`, etc.)
 * because the row must be self-describing — when TanStack fires
 * `onExpandedChange` with a row ID, we need to know *what SQL to run* to load
 * that row's children. In client-side grouping the table already has all the
 * data, but in server-side grouping we need to construct a new GROUP BY query
 * with the right WHERE constraints. The metadata makes each row carry enough
 * context to build its child query without a side-map lookup.
 */
export interface GroupRow {
  /** Discriminant — always `'group'`. */
  readonly type: 'group';
  /** Unique ID (segments separated by GROUP_ID_SEPARATOR). */
  readonly id: string;
  /** Display value at this group level. */
  readonly groupValue: string;
  /** Aggregation values keyed by metric ID (e.g., `{ count: 1234 }`). */
  readonly metrics: Record<string, number>;
  /**
   * TanStack Table convention — child rows populated lazily.
   * Starts as `[]` (empty array signals "expandable but not yet loaded").
   * Filled by `#rebuildTree()` from `#childrenCache` after a child query completes.
   */
  subRows?: Array<ServerGroupedRow>;

  // --- Embedded metadata (prefixed with _ to signal internal use) ----------
  //
  // These fields replace a separate `#rowMeta: Map<string, RowMeta>` side-map.
  // Embedding them directly on the row keeps the data self-describing and
  // avoids Map lookups during expand/collapse operations.

  /** Depth in the group hierarchy (0 = root). */
  readonly _depth: number;
  /**
   * Ancestor equality constraints for building child queries.
   *
   * For a row at depth 2 under USA → Swimming, this would be:
   * `{ nationality: "USA", sport: "Swimming" }`.
   *
   * When the user expands this row, we build the child query as:
   * `WHERE nationality = 'USA' AND sport = 'Swimming' GROUP BY <next level>`.
   */
  readonly _parentConstraints: Record<string, string>;
  /** The SQL column this row was grouped by (e.g. "nationality"). */
  readonly _groupColumn: string;
  /** Whether expanding this row fetches raw leaf rows instead of deeper groups. */
  readonly _isDetailPanel: boolean;
}

/** A raw data row at the leaf level (no aggregation). */
export interface LeafRow {
  /** Discriminant — always `'leaf'`. */
  readonly type: 'leaf';
  /** Unique ID (segments separated by GROUP_ID_SEPARATOR). */
  readonly id: string;
  /** Raw column data keyed by column name. */
  readonly values: Record<string, unknown>;
}
