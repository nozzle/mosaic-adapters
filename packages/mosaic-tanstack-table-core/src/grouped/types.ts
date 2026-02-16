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

/** An aggregated group row with metrics and optional children. */
export interface GroupRow {
  /** Discriminant — always `'group'`. */
  readonly type: 'group';
  /** Unique ID (segments separated by GROUP_ID_SEPARATOR). */
  readonly id: string;
  /** Display value at this group level. */
  readonly groupValue: string;
  /** Aggregation values keyed by metric ID (e.g., `{ count: 1234 }`). */
  readonly metrics: Record<string, number>;
  /** TanStack Table convention — child rows. */
  subRows?: Array<ServerGroupedRow>;
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
