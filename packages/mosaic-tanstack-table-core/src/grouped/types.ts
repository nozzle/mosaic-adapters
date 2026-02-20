/**
 * @file Types for server-side grouped/hierarchical table support.
 *
 * Defines the data model for rows that form a tree structure where each level
 * is loaded lazily from the server via GROUP BY queries, plus optional raw
 * leaf rows at the deepest level.
 *
 * Row data is flat: SQL query result columns sit at the top level (enabling
 * standard TanStack `accessorKey` column definitions), while tree metadata
 * lives under `_groupMeta`. The `subRows` property follows TanStack's
 * convention for tree traversal via `getSubRows`.
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
// Row types — flat data model
// ---------------------------------------------------------------------------

/**
 * Metadata embedded on grouped rows under `_groupMeta`.
 *
 * Each row must be self-describing — when TanStack fires `onExpandedChange`
 * with a row ID, we need to know *what SQL to run* to load that row's
 * children. The metadata makes each row carry enough context to build its
 * child query without a side-map lookup.
 */
export interface GroupMeta {
  /** Discriminant: 'group' for aggregated rows, 'leaf' for raw detail rows. */
  type: 'group' | 'leaf';
  /** Unique composite ID (segments joined by GROUP_ID_SEPARATOR). */
  id: string;
  /** Depth in the hierarchy (0 = root). */
  depth: number;
  /**
   * Ancestor equality constraints for building child queries.
   *
   * For a row at depth 2 under USA → Swimming, this would be:
   * `{ nationality: "USA", sport: "Swimming" }`.
   *
   * When the user expands this row, we build the child query as:
   * `WHERE nationality = 'USA' AND sport = 'Swimming' GROUP BY <next level>`.
   */
  parentConstraints: Record<string, string>;
  /** The SQL column this row was grouped by. Only present on type='group'. */
  groupColumn?: string;
  /** The value of the group column for this row. Only present on type='group'. */
  groupValue?: string;
  /** Whether expanding this row fetches leaf rows instead of deeper groups. */
  isLeafParent?: boolean;
}

/**
 * A row in a grouped MosaicDataTable.
 *
 * SQL result columns sit at the top level (e.g., `nationality`, `count`,
 * `total_gold`), enabling standard TanStack `accessorKey` column definitions.
 * Tree metadata lives under `_groupMeta`. The `subRows` field follows
 * TanStack's convention for tree traversal.
 *
 * @example
 * // Group row from: SELECT nationality, COUNT(*) as count FROM athletes GROUP BY nationality
 * {
 *   nationality: "USA",
 *   count: 500,
 *   _groupMeta: { type: 'group', id: "USA", depth: 0, groupColumn: "nationality", ... },
 *   subRows: [],
 * }
 *
 * // Leaf row from: SELECT name, height FROM athletes WHERE nationality='USA' AND sport='Swimming'
 * {
 *   name: "Michael Phelps",
 *   height: 1.93,
 *   _groupMeta: { type: 'leaf', id: "USA\x1FSwimming\x1F_leaf_42", depth: 2, ... },
 * }
 */
export interface FlatGroupedRow {
  /** Tree metadata. Present on every row when groupBy is active. */
  _groupMeta: GroupMeta;
  /** TanStack tree convention: child rows (populated lazily from cache). */
  subRows?: Array<FlatGroupedRow>;
  /** All other keys are SQL column values at the top level. */
  [key: string]: unknown;
}
