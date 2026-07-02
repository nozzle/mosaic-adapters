import type { Selection } from '@uwdata/mosaic-core';
import type { ColumnFiltersState } from '@tanstack/table-core';

/**
 * Declarative clause kinds for the column-filter bridge. Each kind maps a
 * TanStack column-filter value onto the same clause factories every other
 * Mosaic publisher uses:
 *
 * - `'equals'` — null-safe equality (`clausePoint`). Any non-`undefined`
 *   filter value publishes, including `null` (matches SQL NULLs).
 * - `'ilike'` — case-insensitive substring match (`clauseMatch`, method
 *   `'contains'`). Empty/nullish strings clear the clause.
 * - `'prefix'` — case-insensitive prefix match (`clauseMatch`, method
 *   `'prefix'`). Empty/nullish strings clear the clause.
 * - `'range'` — numeric `[lo, hi]` (`clauseInterval`). Either bound may be
 *   open (nullish, empty string, or non-numeric); a half-open range becomes
 *   a plain `>=`/`<=` clause. Both bounds open clears the clause.
 * - `'date-range'` — like `'range'` with bounds coerced to `Date`
 *   (`Date` kept as-is; strings/numbers via `new Date(...)`).
 * - `'in'` — membership over an array of values (`clausePoints`). A scalar
 *   is treated as a single-element array; an empty array clears the clause.
 */
export type ColumnFilterClauseKind =
  | 'equals'
  | 'ilike'
  | 'prefix'
  | 'range'
  | 'date-range'
  | 'in';

export interface FilterBridgeColumn {
  /** SQL column the clause predicates test; defaults to the TanStack column id. */
  column?: string;
  clause: ColumnFilterClauseKind;
}

/** Per-column bridge config, keyed by TanStack column id. */
export type FilterBridgeColumns = Record<string, FilterBridgeColumn>;

export interface FilterBridgeOptions {
  /**
   * Selection that receives one clause per actively filtered column.
   * Bridge clauses carry no `clients` set, so — deliberately, unlike
   * brush/facet publishers — nothing is self-excluded: the table consuming
   * this Selection is filtered by its own column filters.
   */
  selection: Selection;
  /** Per-column clause config; defaults to none (supply later via `setColumns`). */
  columns?: FilterBridgeColumns;
}

/**
 * Framework-agnostic core of the TanStack column-filter bridge. Owns the
 * clause lifecycle: one stable clause source per column id (replacement,
 * never accumulation), removal when a column's filter clears, and removal
 * of everything on `destroy()`. Publishes are value-diffed — re-submitting
 * equal filter state emits nothing, so render-loop echoes cannot feed back
 * into Selection activations.
 */
export interface FilterBridge {
  /** Reconcile published clauses against the given TanStack filter state. */
  setFilters: (filters: ColumnFiltersState) => void;
  /** Swap the per-column config; affected clauses are republished or removed. */
  setColumns: (columns: FilterBridgeColumns) => void;
  /** Remove every published clause and stop publishing. */
  destroy: () => void;
  /** True once `destroy()` has run; destroyed bridges never publish again. */
  readonly destroyed: boolean;
}
