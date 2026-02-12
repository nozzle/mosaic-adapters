/**
 * @file Types for server-side grouped/hierarchical table support.
 *
 * Defines the data model for rows that form a tree structure where each level
 * is loaded lazily from the server via GROUP BY queries, plus optional raw
 * leaf rows at the deepest level.
 */
import type { ExprValue } from '@uwdata/mosaic-sql';

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

/**
 * A single row in the grouped tree structure.
 *
 * Every row — whether a group (expandable) or a leaf — carries metadata about
 * its position in the hierarchy. TanStack Table navigates children via `subRows`.
 */
export interface GroupedRow {
  /**
   * Unique identifier across all depths.
   * Pipe-delimited ancestry: `"Noise"`, `"Noise|Loud Music"`, `"Noise|Loud Music|Resolved"`.
   */
  _groupId: string;

  /** 0-based depth in the hierarchy. */
  _depth: number;

  /** True when this row has potential children (depth < maxDepth). */
  _isGroup: boolean;

  /** True when this is a raw data row (no aggregation), displayed at the leaf level. */
  _isLeafRow: boolean;

  /** True when this row can expand to show a detail panel with embedded grid. */
  _hasDetailPanel: boolean;

  /** The SQL column that this row's value belongs to. */
  _groupColumn: string;

  /** The actual value at this level (e.g., `"Noise"`). */
  _groupValue: string;

  /**
   * Ancestor column→value pairs used to construct WHERE clauses for child queries
   * and compound selection predicates.
   *
   * @example
   * // For a Level 1 row under complaint_type = "Noise":
   * { complaint_type: "Noise" }
   */
  _parentValues: Record<string, string>;

  /** Whether child rows have been fetched from the server. */
  _childrenLoaded: boolean;

  /** Whether a child query is currently in-flight. */
  _isLoading: boolean;

  /** TanStack Table convention — child rows. `undefined` means not yet loaded. */
  subRows?: Array<GroupedRow>;

  /** Aggregation values keyed by metric ID (e.g., `{ count: 1234 }`). */
  metrics: Record<string, number>;

  /** Raw leaf row data keyed by column name. Only present on leaf rows. */
  leafValues?: Record<string, unknown>;
}
